import { describe, expect, it } from 'vitest'
import { createClipWriter, type ClipAttempt } from './clipWriter'

/** The way the clipboard was written, as the log names it (a word, never a process started here). */
const PS = 'powershell'

type Req = { name: string }

/** A writer whose attempts are answered by hand, in the order they started. */
function handWriter() {
  const calls: Array<{ req: Req; signal: AbortSignal; answer(a: ClipAttempt): void }> = []
  const write = (req: Req, signal: AbortSignal): Promise<ClipAttempt> =>
    new Promise((resolve) => {
      const call = { req, signal, answer: resolve }
      calls.push(call)
      signal.addEventListener('abort', () => resolve({ ok: false, reason: 'superseded', via: 'test' }))
    })
  return { calls, write }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('the Windows clipboard write runs one at a time, newest wins (#484)', () => {
  it('a write that lands says so, with its time', async () => {
    let t = 0
    const h = handWriter()
    const w = createClipWriter<Req>(h.write, { now: () => t })
    const done = w.write({ name: 'a' })
    await tick()
    t = 412
    h.calls[0].answer({ ok: true, via: PS, phase: 'set' })
    expect(await done).toEqual({ ok: true, ms: 412, via: PS, phase: 'set', attempts: 1 })
  })

  it('a write that times out is tried once more, and the second answer is the one said', async () => {
    const h = handWriter()
    const w = createClipWriter<Req>(h.write, { now: () => 0 })
    const done = w.write({ name: 'a' })
    await tick()
    h.calls[0].answer({ ok: false, reason: 'timeout', phase: 'loaded', via: PS })
    await tick()
    expect(h.calls).toHaveLength(2)
    h.calls[1].answer({ ok: true, via: PS, phase: 'set' })
    expect(await done).toMatchObject({ ok: true, attempts: 2, firstReason: 'timeout', firstPhase: 'loaded' })
  })

  it('two failures are a failure, with both reasons', async () => {
    const h = handWriter()
    const w = createClipWriter<Req>(h.write, { now: () => 0 })
    const done = w.write({ name: 'a' })
    await tick()
    h.calls[0].answer({ ok: false, reason: 'timeout', via: PS })
    await tick()
    h.calls[1].answer({ ok: false, reason: 'Source no longer exists', via: PS })
    expect(await done).toMatchObject({ ok: false, attempts: 2, reason: 'Source no longer exists', firstReason: 'timeout' })
  })

  it('a missing source is not retried: it will not come back', async () => {
    const h = handWriter()
    const w = createClipWriter<Req>(h.write, { now: () => 0, retryable: (r) => r !== 'Source no longer exists' })
    const done = w.write({ name: 'a' })
    await tick()
    h.calls[0].answer({ ok: false, reason: 'Source no longer exists', via: PS })
    expect(await done).toMatchObject({ ok: false, attempts: 1 })
    expect(h.calls).toHaveLength(1)
  })

  it('a failed write is not retried once the clipboard changed outside Prism: the retry would overwrite what the user copied since (review, 2026-11-06)', async () => {
    const h = handWriter()
    let changed = false
    const w = createClipWriter<Req>(h.write, { now: () => 0, retryIf: () => !changed })
    const done = w.write({ name: 'a' })
    await tick()
    changed = true
    h.calls[0].answer({ ok: false, reason: 'timeout', via: PS })
    expect(await done).toMatchObject({ ok: false, attempts: 1, reason: 'timeout' })
    expect(h.calls).toHaveLength(1)
  })

  it('a newer copy stops the one still writing, and only the newest reaches the clipboard', async () => {
    const h = handWriter()
    const w = createClipWriter<Req>(h.write, { now: () => 0 })
    const first = w.write({ name: 'old' })
    await tick()
    const second = w.write({ name: 'new' })
    expect(await first).toMatchObject({ ok: false, superseded: true })
    await tick()
    expect(h.calls.map((c) => c.req.name)).toEqual(['old', 'new'])
    expect(h.calls[0].signal.aborted).toBe(true)
    h.calls[1].answer({ ok: true, via: PS })
    expect(await second).toMatchObject({ ok: true })
  })

  it('a writer that throws is a failure, never a rejection', async () => {
    const w = createClipWriter<Req>(() => Promise.reject(new Error('worker gone')), { now: () => 0, retries: 0 })
    expect(await w.write({ name: 'a' })).toMatchObject({ ok: false, reason: 'worker gone' })
  })
})
