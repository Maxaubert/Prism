import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { DiagLog } from 'prism-term-core/main/diagLog'
import { lagTraceName, startNativeTrace, tracesToPrune, type TracingLike } from './nativeTrace'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

type Line = { src: string; k: string; fields?: Record<string, unknown> }

function fakeLog(): DiagLog & { lines: Line[] } {
  const dir = mkdtempSync(join(tmpdir(), 'trace-'))
  dirs.push(dir)
  const lines: Line[] = []
  return {
    dir,
    lines,
    write: (src: string, k: string, fields?: Record<string, unknown>) =>
      lines.push({ src, k, fields })
  } as unknown as DiagLog & { lines: Line[] }
}

function fakeTracing(fail = false): TracingLike & { starts: number; stops: string[] } {
  const t = {
    starts: 0,
    stops: [] as string[],
    startRecording: async () => {
      t.starts += 1
    },
    stopRecording: async (path?: string) => {
      if (fail) throw new Error('no trace')
      t.stops.push(path ?? '')
      if (path) writeFileSync(path, '{}')
      return path ?? ''
    }
  }
  return t
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('nativeTrace', () => {
  it('names files by time, prunes the oldest beyond keep', () => {
    expect(lagTraceName(new Date('2026-10-27T08:12:17.745Z'))).toBe(
      'lag-2026-10-27T08-12-17-745Z.trace.json'
    )
    const names = [
      'lag-a.trace.json',
      'lag-b.trace.json',
      'lag-c.trace.json',
      'lag-a.cpuprofile',
      'diag.jsonl'
    ]
    expect(tracesToPrune(names, 2)).toEqual(['lag-a.trace.json'])
  })

  it('dumps the buffer on a long main-lag, names it in the line and records again', async () => {
    const log = fakeLog()
    const tracing = fakeTracing()
    let t = 100_000
    startNativeTrace({
      log,
      tracing,
      now: () => t,
      wall: () => new Date('2026-10-27T08:12:17.745Z')
    })
    await tick()
    expect(tracing.starts).toBe(1)
    log.write('main', 'main-lag', { ms: 300 })
    expect(log.lines.at(-1)?.fields?.trace).toBeUndefined()
    log.write('main', 'main-lag', { ms: 3980 })
    expect(log.lines.at(-1)?.fields?.trace).toBe('lag-2026-10-27T08-12-17-745Z.trace.json')
    // Recording restarts after the prune's readdir, which is real disk work:
    // wait for it, never count ticks (the release run's CI was slower).
    await vi.waitFor(() => expect(tracing.starts).toBe(2))
    expect(readdirSync(log.dir)).toContain('lag-2026-10-27T08-12-17-745Z.trace.json')
    // A second lag inside the gap writes nothing more.
    t += 10_000
    log.write('main', 'main-lag', { ms: 2000 })
    expect(log.lines.at(-1)?.fields?.trace).toBeUndefined()
    expect(tracing.stops).toHaveLength(1)
  })

  it('says so when a dump fails, and keeps recording', async () => {
    const log = fakeLog()
    const tracing = fakeTracing(true)
    startNativeTrace({ log, tracing })
    await tick()
    log.write('main', 'main-lag', { ms: 1500 })
    await vi.waitFor(() => expect(tracing.starts).toBe(2))
    expect(log.lines.some((l) => l.k === 'lag-trace' && l.fields?.missing === true)).toBe(true)
  })

  it('stop hands write back', async () => {
    const log = fakeLog()
    const write = log.write
    const trace = startNativeTrace({ log, tracing: fakeTracing() })
    expect(log.write).not.toBe(write)
    trace.stop()
    expect(log.write).toBe(write)
    vi.restoreAllMocks()
  })
})
