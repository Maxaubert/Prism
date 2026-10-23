import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiagApi, DiagPageLine } from '../../preload/diagApi'
import { crumb, crumbsBefore, errorLine, loafLine, recentCrumbs, resetDiag, shortSrc, startDiag, time } from './diag'

function fakeApi(verbose = false): DiagApi & { batches: DiagPageLine[][]; beats: number } {
  const api = {
    batches: [] as DiagPageLine[][],
    beats: 0,
    diagBatch: (lines: DiagPageLine[]) => {
      api.batches.push(lines)
    },
    diagBeat: () => {
      api.beats += 1
    },
    diagInfo: () => Promise.resolve({ verbose, dir: 'C:\\logs' }),
    diagSetVerbose: (on: boolean) => Promise.resolve(on),
    diagOpenFolder: () => {},
    diagMark: () => {}
  }
  return api
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_800_000_000_000)
  resetDiag()
})
afterEach(() => {
  resetDiag()
  vi.useRealTimers()
})

describe('shortSrc', () => {
  it("keeps a script's own name and drops where the app is installed", () => {
    expect(shortSrc('file:///C:/Users/x/AppData/Local/Programs/PrismTerminal/resources/app.asar/out/renderer/assets/index-abc.js')).toBe(
      'assets/index-abc.js'
    )
    expect(shortSrc('http://localhost:5173/src/App.tsx?t=1')).toBe('src/App.tsx')
    expect(shortSrc('')).toBe(null)
  })
})

describe('loafLine', () => {
  const ORIGIN = 1_800_000_000_000
  const entry = {
    startTime: 1000,
    duration: 2512.6,
    blockingDuration: 2462.2,
    scripts: [
      { sourceURL: 'file:///app/out/renderer/assets/index.js', sourceFunctionName: 'tick', invoker: 'TimerHandler:setTimeout', duration: 12 },
      { sourceURL: 'file:///app/out/renderer/assets/index.js', sourceFunctionName: 'spinHard', invoker: 'BUTTON.onclick', duration: 2490.4 }
    ]
  }

  it('names the time, how long it blocked, and the scripts that ran, longest first', () => {
    const line = loafLine(entry, ORIGIN, [])
    expect(line).toEqual({
      k: 'page-stall',
      at: ORIGIN + 1000,
      ms: 2513,
      blocking: 2462,
      scripts: [
        { src: 'assets/index.js', fn: 'spinHard', invoker: 'BUTTON.onclick', ms: 2490 },
        { src: 'assets/index.js', fn: 'tick', invoker: 'TimerHandler:setTimeout', ms: 12 }
      ],
      crumbs: []
    })
  })

  it('carries the last five crumbs before the stall, and how long before', () => {
    const ring = Array.from({ length: 8 }, (_, i) => ({ a: `c${i}`, at: ORIGIN + 100 * i }))
    const line = loafLine(entry, ORIGIN, ring)
    expect(line.crumbs).toEqual([
      { a: 'c3', ago: 700 },
      { a: 'c4', ago: 600 },
      { a: 'c5', ago: 500 },
      { a: 'c6', ago: 400 },
      { a: 'c7', ago: 300 }
    ])
  })

  it('reads an entry with no scripts', () => {
    expect(loafLine({ startTime: 0, duration: 300 }, ORIGIN, []).scripts).toEqual([])
  })
})

describe('crumbsBefore', () => {
  it('leaves out a crumb that came after the stall ended', () => {
    const ring = [
      { a: 'before', at: 100 },
      { a: 'after', at: 5000 }
    ]
    expect(crumbsBefore(ring, 200, 300).map((c) => c.a)).toEqual(['before'])
  })
})

describe('errorLine', () => {
  it('reads an error event and a rejection', () => {
    expect(errorLine('page-error', { message: 'x is undefined', error: new Error('x is undefined'), filename: 'file:///a/out/renderer/assets/index.js', lineno: 3, colno: 9 })).toMatchObject({
      k: 'page-error',
      msg: 'x is undefined',
      loc: 'assets/index.js:3:9'
    })
    expect(errorLine('page-rejection', { reason: 'plain' })).toMatchObject({ k: 'page-rejection', msg: 'plain' })
  })
})

describe('the crumb ring', () => {
  it('keeps the last fifty, sent or not', () => {
    for (let i = 0; i < 60; i += 1) crumb(`a${i}`)
    const ring = recentCrumbs()
    expect(ring).toHaveLength(50)
    expect(ring[0].a).toBe('a10')
  })
})

describe('startDiag', () => {
  it('batches crumbs every 250 ms, beats every 500 ms, and sends nothing before it starts', async () => {
    crumb('early')
    const api = fakeApi()
    const stop = startDiag(api)
    await vi.advanceTimersByTimeAsync(0)
    crumb('tab-open', { cwd: 'C:\\x' })
    crumb('tab-switch')
    expect(api.batches).toEqual([])
    await vi.advanceTimersByTimeAsync(260)
    expect(api.batches).toHaveLength(1)
    expect(api.batches[0].map((l) => [l.k, l.a])).toEqual([
      ['crumb', 'tab-open'],
      ['crumb', 'tab-switch']
    ])
    expect(api.batches[0][0]).toMatchObject({ cwd: 'C:\\x', at: 1_800_000_000_000 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(api.beats).toBe(2)
    stop()
  })

  it('keeps a high-rate crumb in the ring only, unless logging is detailed', async () => {
    const quiet = fakeApi(false)
    const stop = startDiag(quiet)
    await vi.advanceTimersByTimeAsync(0)
    crumb('scroll', {}, { often: true })
    await vi.advanceTimersByTimeAsync(300)
    expect(quiet.batches).toEqual([])
    expect(recentCrumbs().at(-1)?.a).toBe('scroll')
    stop()

    resetDiag()
    const loud = fakeApi(true)
    const stop2 = startDiag(loud)
    await vi.advanceTimersByTimeAsync(0)
    crumb('scroll', {}, { often: true })
    await vi.advanceTimersByTimeAsync(300)
    expect(loud.batches.flat().map((l) => l.a)).toEqual(['scroll'])
    stop2()
  })
})

describe('an error on every frame', () => {
  it('is one line per 10 s with a count, not sixty a second', async () => {
    const listeners = new Map<string, (ev: never) => void>()
    const target = {
      addEventListener: (type: string, fn: (ev: never) => void) => listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type)
    }
    const api = fakeApi()
    const stop = startDiag(api, target)
    await vi.advanceTimersByTimeAsync(0)
    const fire = (): void =>
      listeners.get('error')!({ error: new Error('loop'), filename: 'file:///app/out/renderer/a.js', lineno: 1 } as never)
    for (let i = 0; i < 60 * 5; i += 1) {
      fire()
      await vi.advanceTimersByTimeAsync(16)
    }
    const errors = (): Array<Record<string, unknown>> => api.batches.flat().filter((l) => l.k === 'page-error')
    expect(errors()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(6000)
    expect(errors()).toHaveLength(2)
    expect(errors()[1].repeats).toBe(299)
    stop()
  })
})

describe('time', () => {
  it('returns what the work returned, and logs it only past the threshold', async () => {
    const api = fakeApi()
    const stop = startDiag(api)
    await vi.advanceTimersByTimeAsync(0)
    expect(time('sort-slow', () => 7, { n: 3 })).toBe(7)
    await vi.advanceTimersByTimeAsync(300)
    expect(api.batches).toEqual([])
    const slow = time(
      'sort-slow',
      () => {
        vi.setSystemTime(Date.now() + 80)
        return 'done'
      },
      { n: 9000 },
      50,
      () => Date.now()
    )
    expect(slow).toBe('done')
    await vi.advanceTimersByTimeAsync(300)
    expect(api.batches.flat()).toEqual([expect.objectContaining({ k: 'sort-slow', ms: 80, n: 9000 })])
    stop()
  })
})
