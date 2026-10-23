import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiagLog } from './diagLog'
import { startMemWatch, type ProcessMetricLike } from './memWatch'

const fakeLog = (): { log: DiagLog; lines: Array<{ k: string; f: Record<string, unknown> }> } => {
  const lines: Array<{ k: string; f: Record<string, unknown> }> = []
  const log = { write: (_src: string, k: string, f?: Record<string, unknown>) => lines.push({ k, f: f ?? {} }) } as unknown as DiagLog
  return { log, lines }
}
const proc = (type: string, mb: number): ProcessMetricLike => ({ type, memory: { workingSetSize: mb * 512, privateBytes: mb * 1024 } })

describe('the memory watch (2026-10-16: a 15.9 GB page nobody saw growing)', () => {
  afterEach(() => vi.useRealTimers())

  it('a crumb with each kind of process, in MB of private memory', () => {
    const { log, lines } = fakeLog()
    const w = startMemWatch({ log, metrics: () => [proc('Browser', 240), proc('Tab', 300), proc('GPU', 350), proc('Utility', 13)] })
    w.sample()
    w.stop()
    expect(lines).toEqual([{ k: 'crumb', f: { a: 'memory', mainMb: 240, pageMb: 300, gpuMb: 350, otherMb: 13 } }])
  })

  it('every five minutes, by itself', async () => {
    vi.useFakeTimers()
    const { log, lines } = fakeLog()
    const w = startMemWatch({ log, metrics: () => [proc('Tab', 100)] })
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
    w.stop()
    expect(lines.filter((l) => l.k === 'crumb')).toHaveLength(3)
  })

  it('mem-high when the page passes 2 GB, then only at each doubling', () => {
    const { log, lines } = fakeLog()
    let page = 1500
    const w = startMemWatch({ log, metrics: () => [proc('Tab', page)] })
    const highs = (): number[] => lines.filter((l) => l.k === 'mem-high').map((l) => l.f.overMb as number)
    w.sample()
    expect(highs()).toEqual([])
    page = 2100
    w.sample()
    page = 3000
    w.sample()
    expect(highs()).toEqual([2048])
    page = 9800 // past 4 and 8 GB at once: one line, the next at 16 GB
    w.sample()
    page = 15900
    w.sample()
    expect(highs()).toEqual([2048, 4096])
    page = 16500
    w.sample()
    expect(highs()).toEqual([2048, 4096, 16384])
    w.stop()
  })

  // Perf review 2026-10-16: a main or GPU leak raised no alarm.
  it('mem-high for main past 1 GB and the GPU process past 2 GB, each doubling on its own', () => {
    const { log, lines } = fakeLog()
    let main = 900
    let gpu = 1500
    const w = startMemWatch({ log, metrics: () => [proc('Browser', main), proc('Tab', 300), proc('GPU', gpu)] })
    const highs = (): Array<[unknown, unknown]> => lines.filter((l) => l.k === 'mem-high').map((l) => [l.f.proc, l.f.overMb])
    w.sample()
    expect(highs()).toEqual([])
    main = 1100
    w.sample()
    w.sample()
    expect(highs()).toEqual([['main', 1024]])
    gpu = 2100
    main = 2100
    w.sample()
    expect(highs()).toEqual([
      ['main', 1024],
      ['main', 2048],
      ['gpu', 2048]
    ])
    w.stop()
  })

  it('the working set where there are no private bytes; a metrics call that throws is skipped', () => {
    const { log, lines } = fakeLog()
    let fail = false
    const w = startMemWatch({
      log,
      metrics: () => {
        if (fail) throw new Error('gone')
        return [{ type: 'Tab', memory: { workingSetSize: 200 * 1024 } }]
      }
    })
    w.sample()
    fail = true
    w.sample()
    w.stop()
    expect(lines).toEqual([{ k: 'crumb', f: { a: 'memory', mainMb: 0, pageMb: 200, gpuMb: 0, otherMb: 0 } }])
  })
})
