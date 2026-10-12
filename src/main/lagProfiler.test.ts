import { describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { NULL_DIAG_LOG, type DiagLog } from 'prism-term-core/main/diagLog'
import {
  lagProfileName,
  profilesToPrune,
  startLagProfiler,
  windowsCovering,
  type ProfileWindow,
  type SessionLike
} from './lagProfiler'
import { summarizeLag, type CpuProfile } from './lagSummary'

const w = (start: number, end: number): ProfileWindow => ({ start, end, profile: { start } })

describe('windowsCovering', () => {
  it('picks the running window when it holds the whole lag', () => {
    expect(windowsCovering([w(5000, 12000), w(0, 5000)], 8000, 11000)).toEqual([w(5000, 12000)])
  })
  it('adds the older window when the lag began inside it, newest first', () => {
    expect(windowsCovering([w(0, 5000), w(5000, 12000)], 4000, 11000)).toEqual([
      w(5000, 12000),
      w(0, 5000)
    ])
  })
  it('puts first the window holding most of the lag, even an older one', () => {
    // The rotation fired just after the lag, before the detector logged it:
    // the running window holds only the last 10 ms (review, 2026-10-12).
    expect(windowsCovering([w(6000, 6010), w(0, 6000)], 4960, 6010)).toEqual([
      w(0, 6000),
      w(6000, 6010)
    ])
  })
  it('skips a missing window', () => {
    expect(windowsCovering([null, w(0, 5000)], 1000, 2000)).toEqual([w(0, 5000)])
  })
})

describe('lagProfileName', () => {
  it('is an ISO time with no colons, and an older window says prev', () => {
    const at = new Date('2026-10-12T09:30:01.123Z')
    expect(lagProfileName(at)).toBe('lag-2026-10-12T09-30-01-123Z.cpuprofile')
    expect(lagProfileName(at, 1)).toBe('lag-2026-10-12T09-30-01-123Z-prev.cpuprofile')
  })
})

describe('profilesToPrune', () => {
  it('keeps the newest ones and touches nothing else', () => {
    const names = [
      'diag.jsonl',
      'lag-2026-10-12T09-00-03-000Z.cpuprofile',
      'lag-2026-10-12T09-00-01-000Z.cpuprofile',
      'lag-2026-10-12T09-00-02-000Z.cpuprofile'
    ]
    expect(profilesToPrune(names, 2)).toEqual(['lag-2026-10-12T09-00-01-000Z.cpuprofile'])
    expect(profilesToPrune(names, 10)).toEqual([])
  })
})

/** A session whose calls answer at once, as an in-thread inspector session does. */
function fakeSession(calls: string[]): SessionLike {
  let n = 0
  return {
    connect: () => calls.push('connect'),
    disconnect: () => calls.push('disconnect'),
    post: (method, _params, cb) => {
      calls.push(method)
      cb?.(null, method === 'Profiler.stop' ? { profile: { n: ++n } } : {})
    }
  }
}

function fakeLog(dir: string): DiagLog & { lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = []
  return { ...NULL_DIAG_LOG, dir, lines, write: (_src, k, f) => void lines.push({ k, ...f }) }
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 50))

describe('startLagProfiler', () => {
  it('does nothing at all while off', () => {
    const calls: string[] = []
    const log = fakeLog(mkdtempSync(join(tmpdir(), 'lagprof-')))
    const p = startLagProfiler({ log, enabled: () => false, session: () => fakeSession(calls) })
    log.write('main', 'main-lag', { ms: 3000 })
    p.stop()
    expect(calls).toEqual([])
    expect(log.lines).toEqual([{ k: 'main-lag', ms: 3000 }])
  })

  it('names the profile on a lag of 1 s or more and writes it, keeping the newest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lagprof-'))
    for (let i = 0; i < 3; i++)
      writeFileSync(join(dir, `lag-2000-01-01T00-00-0${i}-000Z.cpuprofile`), '{}')
    const log = fakeLog(dir)
    let t = 0
    const p = startLagProfiler({
      log,
      enabled: () => true,
      session: () => fakeSession([]),
      now: () => t,
      wall: () => new Date('2026-10-12T09:30:01.123Z'),
      keep: 2
    })
    t = 3000
    log.write('main', 'main-lag', { ms: 400 })
    t = 4000
    log.write('main', 'main-lag', { ms: 2500 })
    await settle()
    p.stop()
    expect(log.lines[0]).toEqual({ k: 'main-lag', ms: 400 })
    expect(log.lines[1]).toEqual({
      k: 'main-lag',
      ms: 2500,
      profile: 'lag-2026-10-12T09-30-01-123Z.cpuprofile'
    })
    const names = readdirSync(dir).sort()
    expect(names).toEqual([
      'lag-2000-01-01T00-00-02-000Z.cpuprofile',
      'lag-2026-10-12T09-30-01-123Z.cpuprofile'
    ])
    expect(JSON.parse(readFileSync(join(dir, names[1]), 'utf8'))).toEqual({ n: 1 })
  })

  it('names the window that holds the lag when the rotation fired first', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lagprof-'))
    const log = fakeLog(dir)
    let t = 0
    const p = startLagProfiler({
      log,
      enabled: () => true,
      session: () => fakeSession([]),
      now: () => t,
      wall: () => new Date('2026-10-12T09:30:01.123Z')
    })
    // Main blocked 5000 to 6000; the rotation ran at 6000, the detector at 6010.
    t = 6000
    p.rotate()
    await settle()
    t = 6010
    log.write('main', 'main-lag', { ms: 1000 })
    await settle()
    p.stop()
    const read = (n: string): unknown => JSON.parse(readFileSync(join(dir, n), 'utf8'))
    // Window 1 (0 to 6000) holds the lag; window 2 (6000 to 6010) only its tail.
    expect(read('lag-2026-10-12T09-30-01-123Z.cpuprofile')).toEqual({ n: 1 })
    expect(read('lag-2026-10-12T09-30-01-123Z-prev.cpuprofile')).toEqual({ n: 2 })
  })

  it('stops its session when Detailed logging is turned off', () => {
    const calls: string[] = []
    let on = true
    const p = startLagProfiler({
      log: fakeLog(tmpdir()),
      enabled: () => on,
      session: () => fakeSession(calls)
    })
    on = false
    p.rotate()
    expect(calls).toEqual([
      'connect',
      'Profiler.enable',
      'Profiler.setSamplingInterval',
      'Profiler.start',
      'Profiler.stop',
      'disconnect'
    ])
    p.stop()
  })
})

describe('summarizeLag', () => {
  const frame = (functionName: string, url = '', lineNumber = 0) => ({
    functionName,
    url,
    lineNumber
  })
  const profile: CpuProfile = {
    nodes: [
      { id: 1, callFrame: frame('(root)') },
      { id: 2, callFrame: frame('(idle)') },
      { id: 3, callFrame: frame('spin', 'file:///C:/app/out/main/index.js', 41) },
      { id: 4, callFrame: frame('(program)') },
      { id: 5, callFrame: frame('(garbage collector)') }
    ],
    startTime: 0,
    endTime: 3_000_000,
    // 1 s of idle (outside the lag), then 1.5 s in spin, 0.3 s program, 0.2 s gc.
    samples: [2, 3, 4, 5],
    timeDeltas: [1_000_000, 1_500_000, 300_000, 200_000]
  }
  it('counts only the lag at the end of the window, and names the function', () => {
    expect(summarizeLag(profile, 2000)).toEqual({
      jsMs: 1500,
      gcMs: 200,
      nativeMs: 300,
      top: ['spin index.js:42 1500ms']
    })
  })
  it('skips the tail a window ran on after the lag', () => {
    // The window ran 0.2 s past the lag (the gc sample): the lag is the 2 s
    // before it, 0.2 s of idle, the 1.5 s spin and 0.3 s of program.
    expect(summarizeLag(profile, 2000, 3, 200)).toEqual({
      jsMs: 1500,
      gcMs: 0,
      nativeMs: 500,
      top: ['spin index.js:42 1500ms']
    })
  })
  it('says a lag spent outside JavaScript is that', () => {
    expect(summarizeLag({ ...profile, samples: [2, 2, 2, 2] }, 2000)).toEqual({
      jsMs: 0,
      gcMs: 0,
      nativeMs: 2000,
      top: []
    })
  })
  it('answers null for something that is not a profile', () => {
    expect(summarizeLag({ n: 1 } as unknown as CpuProfile, 1000)).toBeNull()
  })
})

describe('summarizeLag on a builtin', () => {
  it("names the code that called it, past Node's own wrappers", () => {
    const profile: CpuProfile = {
      nodes: [
        { id: 1, callFrame: { functionName: '(root)', url: '', lineNumber: -1 }, children: [2] },
        {
          id: 2,
          callFrame: {
            functionName: 'flush',
            url: 'file:///C:/app/out/main/index.js',
            lineNumber: 272
          },
          children: [4]
        },
        {
          id: 4,
          callFrame: { functionName: 'spawn', url: 'node:child_process', lineNumber: 801 },
          children: [3]
        },
        { id: 3, callFrame: { functionName: 'spawn', url: '', lineNumber: -1 } }
      ],
      startTime: 0,
      endTime: 400_000,
      samples: [3],
      timeDeltas: [400_000]
    }
    expect(summarizeLag(profile, 400)?.top).toEqual(['spawn in flush index.js:273 400ms'])
  })
})
