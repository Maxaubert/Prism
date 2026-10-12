import { describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { createDocClient, type WorkerLike } from './docClient'

// Documents are converted on a worker thread, never main (2026-10-12): the
// first .docx of a session held main 2.2 s loading mammoth, the first
// sanitise up to 1.1 s loading the rehype tree (measured by the lag profiler).

class FakeWorker implements WorkerLike {
  posted: { id: number; path: string }[] = []
  handlers = new Map<string, ((m?: unknown) => void)[]>()
  terminated = false
  unrefd = false
  postMessage(m: unknown): void {
    this.posted.push(m as { id: number; path: string })
  }
  on(event: string, fn: (m?: unknown) => void): this {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn])
    return this
  }
  emit(event: string, m?: unknown): void {
    for (const fn of this.handlers.get(event) ?? []) fn(m)
  }
  unref(): void {
    this.unrefd = true
  }
  terminate(): void {
    this.terminated = true
  }
}

describe('the document client', () => {
  it('asks one worker, and answers each call with its own reply', async () => {
    const made: FakeWorker[] = []
    const client = createDocClient(() => {
      const w = new FakeWorker()
      made.push(w)
      return w
    })
    const a = client.html('C:/a.docx')
    const b = client.html('C:/b.epub')
    expect(made).toHaveLength(1)
    expect(made[0].unrefd).toBe(true)
    const [ra, rb] = made[0].posted
    expect([ra.path, rb.path]).toEqual(['C:/a.docx', 'C:/b.epub'])
    made[0].emit('message', { id: rb.id, html: '<p>b</p>' })
    made[0].emit('message', { id: ra.id, html: null })
    await expect(a).resolves.toBeNull()
    await expect(b).resolves.toBe('<p>b</p>')
  })

  it('rejects a failed conversion, and every call a dead worker had', async () => {
    const made: FakeWorker[] = []
    const client = createDocClient(() => {
      const w = new FakeWorker()
      made.push(w)
      return w
    })
    const bad = client.html('C:/bad.docx')
    made[0].emit('message', { id: made[0].posted[0].id, error: 'corrupt' })
    await expect(bad).rejects.toThrow('corrupt')
    const lost = client.html('C:/c.docx')
    made[0].emit('exit')
    await expect(lost).rejects.toThrow(/stopped/)
    // The next document starts a fresh worker.
    void client.html('C:/d.docx')
    expect(made).toHaveLength(2)
  })

  it('lets an idle worker go, and starts again when asked', async () => {
    vi.useFakeTimers()
    try {
      const made: FakeWorker[] = []
      const client = createDocClient(() => {
        const w = new FakeWorker()
        made.push(w)
        return w
      }, 1000)
      const a = client.html('C:/a.docx')
      made[0].emit('message', { id: made[0].posted[0].id, html: 'x' })
      await a
      vi.advanceTimersByTime(999)
      expect(made[0].terminated).toBe(false)
      vi.advanceTimersByTime(1)
      expect(made[0].terminated).toBe(true)
      void client.html('C:/b.docx')
      expect(made).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('main never loads a converter', () => {
  it('index.ts and the ipc/ handlers reach documents only through the client', () => {
    const ipc = join(__dirname, 'ipc')
    const src = [
      readFileSync(join(__dirname, 'index.ts'), 'utf8'),
      ...readdirSync(ipc)
        .filter((f) => f.endsWith('.ts'))
        .map((f) => readFileSync(join(ipc, f), 'utf8'))
    ].join('\n')
    expect(src).not.toMatch(/from '\.\.?\/docSanitize'/)
    expect(src).not.toMatch(/\bconvertDoc\b/)
    expect(src).not.toMatch(/import\(['"](mammoth|xlsx|unified|rehype-[a-z]+)['"]\)/)
    expect(src).toMatch(/createDocClient\(\)/)
  })
})
