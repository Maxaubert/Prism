import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { spawn } from 'child_process'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelPeaks, loadPeaks } from './peaks'

// The waveform's jobs (review, 2026-10-16): a fake ffmpeg per spawn, so the
// test can see how many decodes run at once and which ones were killed.
vi.mock('child_process', () => ({ spawn: vi.fn() }))
vi.mock('./holders', () => ({ holders: { add: vi.fn() } }))

interface Fake extends EventEmitter {
  stdout: PassThrough
  stderr: PassThrough
  killed: boolean
  kill: () => void
}

let procs: Fake[] = []

beforeEach(() => {
  procs = []
  vi.mocked(spawn).mockImplementation((() => {
    const p = new EventEmitter() as Fake
    p.stdout = new PassThrough()
    p.stderr = new PassThrough()
    p.killed = false
    p.kill = () => {
      p.killed = true
      setTimeout(() => p.emit('close', null), 0)
    }
    procs.push(p)
    return p
  }) as unknown as typeof spawn)
})

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5))
// A job spawns only after its real stat (the cache key) answers, which can
// take far longer than a tick on a busy CI runner: wait for the spawn itself.
const spawned = (n: number): Promise<void> =>
  vi.waitFor(() => expect(procs).toHaveLength(n), { timeout: 4000, interval: 5 })
const finish = (p: Fake): void => {
  p.stdout.write(Buffer.from([0, 0x40, 0, 0x20]))
  setTimeout(() => p.emit('close', 0), 1)
}

describe('the waveform jobs', () => {
  it('runs one decode at a time, and a cancel stops the running one', async () => {
    const a = loadPeaks('ffmpeg', 'prism-no-such-dir/a.mkv', 60)
    const b = loadPeaks('ffmpeg', 'prism-no-such-dir/b.mkv', 60)
    await spawned(1)
    await tick()
    expect(procs).toHaveLength(1) // b waits its turn
    cancelPeaks('prism-no-such-dir/a.mkv')
    expect(procs[0].killed).toBe(true)
    expect(await a).toBeNull() // a killed job's half-envelope is never kept
    await spawned(2)
    finish(procs[1])
    expect((await b)?.length).toBeGreaterThan(0)
  })

  it('shares one job between two asks, and keeps it while one still waits', async () => {
    const a1 = loadPeaks('ffmpeg', 'prism-no-such-dir/c.mkv', 60)
    const a2 = loadPeaks('ffmpeg', 'prism-no-such-dir/c.mkv', 60)
    await spawned(1)
    cancelPeaks('prism-no-such-dir/c.mkv')
    expect(procs[0].killed).toBe(false) // the other tab still wants it
    finish(procs[0])
    expect(await a2).toBe(await a1)
  })

  it('keeps a cancel that arrives while the cache key is still being read', async () => {
    const probe = vi.fn(async () => 60)
    const asked = loadPeaks('ffmpeg', 'prism-no-such-dir/f.mkv', probe)
    cancelPeaks('prism-no-such-dir/f.mkv') // before the stat has answered
    expect(await asked).toBeNull()
    expect(probe).not.toHaveBeenCalled()
    expect(procs).toHaveLength(0)
    // ...and nothing was left at the head of the queue: the next file decodes.
    const next = loadPeaks('ffmpeg', 'prism-no-such-dir/g.mkv', 60)
    await spawned(1)
    finish(procs[0])
    expect((await next)?.length).toBeGreaterThan(0)
  })

  it('never probes or spawns for a job cancelled while it queued', async () => {
    const first = loadPeaks('ffmpeg', 'prism-no-such-dir/d.mkv', 60)
    const probe = vi.fn(async () => 60)
    const queued = loadPeaks('ffmpeg', 'prism-no-such-dir/e.mkv', probe)
    await spawned(1)
    cancelPeaks('prism-no-such-dir/e.mkv')
    finish(procs[0])
    await first
    expect(await queued).toBeNull()
    expect(probe).not.toHaveBeenCalled()
    expect(procs).toHaveLength(1)
  })
})
