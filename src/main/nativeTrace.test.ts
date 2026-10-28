import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { DiagLog } from 'prism-term-core/main/diagLog'
import {
  TRACE_BUFFER_KB,
  TRACE_CATEGORIES,
  lagTraceName,
  leftoverTraceTmps,
  startNativeTrace,
  tracesToPrune,
  type TracingLike
} from './nativeTrace'

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

function fakeTracing(
  fail = false
): TracingLike & { starts: number; stops: string[]; options: Record<string, unknown>[] } {
  const t = {
    starts: 0,
    stops: [] as string[],
    options: [] as Record<string, unknown>[],
    startRecording: async (o: object) => {
      t.starts += 1
      t.options.push(o as Record<string, unknown>)
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
const GUID = '4dd63f03-0899-4941-94c8-1416ebe141ec'

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

  it('also prunes the oldest while the kept traces add up to too much, never the newest', () => {
    const mb = 1024 * 1024
    const files = [
      { name: 'lag-a.trace.json', size: 20 * mb },
      { name: 'lag-b.trace.json', size: 20 * mb },
      { name: 'lag-c.trace.json', size: 20 * mb }
    ]
    expect(tracesToPrune(files, 5, 50 * mb)).toEqual(['lag-a.trace.json'])
    expect(tracesToPrune([{ name: 'lag-z.trace.json', size: 90 * mb }], 5, 50 * mb)).toEqual([])
  })

  it('finds the .tmp an unfinished dump left, only from before this session (review, 2026-10-28)', () => {
    const files = [
      { name: `${GUID}.tmp`, mtimeMs: 1000 },
      { name: `${GUID.replace('4', '5')}.tmp`, mtimeMs: 9000 },
      { name: 'notes.tmp', mtimeMs: 1000 },
      { name: 'lag-a.trace.json', mtimeMs: 1000 }
    ]
    expect(leftoverTraceTmps(files, 5000)).toEqual([`${GUID}.tmp`])
  })

  it('records a small buffer of toplevel and Electron events, not every IPC and mojo message', async () => {
    const tracing = fakeTracing()
    const trace = startNativeTrace({ log: fakeLog(), tracing })
    await tick()
    trace.stop()
    expect(TRACE_BUFFER_KB).toBeLessThanOrEqual(2 * 1024)
    expect(tracing.options[0]).toMatchObject({
      recording_mode: 'record-continuously',
      trace_buffer_size_in_kb: TRACE_BUFFER_KB
    })
    expect(TRACE_CATEGORIES).toContain('toplevel')
    for (const c of ['ipc', 'mojom', 'gpu', 'loading']) expect(TRACE_CATEGORIES).not.toContain(c)
  })

  it('dumps the buffer on a long main-lag, names it in the line and records again later', async () => {
    const log = fakeLog()
    const tracing = fakeTracing()
    let t = 100_000
    startNativeTrace({
      log,
      tracing,
      now: () => t,
      wall: () => new Date('2026-10-27T08:12:17.745Z'),
      restartMs: 0
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
    // A lag just after the dump is marked as the dump's own, with no dump.
    t += 10_000
    log.write('main', 'main-lag', { ms: 2000 })
    expect(log.lines.at(-1)?.fields).toEqual({ ms: 2000, afterDump: true })
    // Later, but inside the gap: nothing more either.
    t += 60_000
    log.write('main', 'main-lag', { ms: 2000 })
    expect(log.lines.at(-1)?.fields).toEqual({ ms: 2000 })
    expect(tracing.stops).toHaveLength(1)
  })

  it('marks a lag during a dump afterDump', async () => {
    const log = fakeLog()
    let release = (): void => {}
    const tracing: TracingLike = {
      startRecording: async () => {},
      stopRecording: () => new Promise<string>((r) => (release = () => r('')))
    }
    startNativeTrace({ log, tracing })
    await tick()
    log.write('main', 'main-lag', { ms: 1500 })
    log.write('main', 'main-lag', { ms: 2500 })
    expect(log.lines.at(-1)?.fields).toEqual({ ms: 2500, afterDump: true })
    release()
  })

  it('does not dump while the disk is slow', async () => {
    const log = fakeLog()
    const tracing = fakeTracing()
    let t = 100_000
    startNativeTrace({ log, tracing, now: () => t })
    await tick()
    log.write('main', 'fs-slow', { ms: 3891 })
    t += 5000
    log.write('main', 'main-lag', { ms: 3867 })
    expect(log.lines.at(-1)?.fields?.trace).toBeUndefined()
    expect(tracing.stops).toHaveLength(0)
    t += 60_000
    log.write('main', 'main-lag', { ms: 1500 })
    expect(typeof log.lines.at(-1)?.fields?.trace).toBe('string')
  })

  it('says so when a dump fails, and keeps recording', async () => {
    const log = fakeLog()
    const tracing = fakeTracing(true)
    startNativeTrace({ log, tracing, restartMs: 0 })
    await tick()
    log.write('main', 'main-lag', { ms: 1500 })
    await vi.waitFor(() => expect(tracing.starts).toBe(2))
    expect(log.lines.some((l) => l.k === 'lag-trace' && l.fields?.missing === true)).toBe(true)
  })

  it('stop hands write back, and dumps nothing more once quitting', async () => {
    const log = fakeLog()
    const write = log.write
    const tracing = fakeTracing()
    const trace = startNativeTrace({ log, tracing })
    await tick()
    expect(log.write).not.toBe(write)
    trace.stop()
    expect(log.write).toBe(write)
    log.write('main', 'main-lag', { ms: 5000 })
    expect(tracing.stops).toHaveLength(0)
  })

  it('sweeps a leftover .tmp from an earlier session, and keeps one of its own', async () => {
    const log = fakeLog()
    const old = join(log.dir, `${GUID}.tmp`)
    writeFileSync(old, '{"traceEvents":[')
    utimesSync(old, new Date('2026-10-28T09:10:30Z'), new Date('2026-10-28T09:10:30Z'))
    const mine = join(log.dir, `${GUID.replace('4', '6')}.tmp`)
    writeFileSync(mine, '{"traceEvents":[')
    const trace = startNativeTrace({
      log,
      tracing: fakeTracing(),
      wall: () => new Date(Date.now() - 60_000),
      sweepDelayMs: 0
    })
    await vi.waitFor(() => expect(readdirSync(log.dir)).not.toContain(`${GUID}.tmp`))
    expect(readdirSync(log.dir)).toContain(`${GUID.replace('4', '6')}.tmp`)
    trace.stop()
  })
})
