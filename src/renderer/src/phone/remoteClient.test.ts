import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RemoteState } from '@shared/remote'
import { emptyState } from '@shared/remote'
import { writeToken } from './api'
import {
  backoff,
  connect,
  noticeFor,
  parseFrame,
  send,
  shownClock,
  type ClientDeps,
  type StreamSource
} from './remoteClient'

/** An EventSource that does nothing until the test fires an event at it. */
class FakeSource implements StreamSource {
  readonly listeners = new Map<string, ((e: { data?: unknown }) => void)[]>()
  closed = false
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: (e: { data?: unknown }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  close(): void {
    this.closed = true
  }
  fire(type: string, data?: unknown): void {
    for (const l of this.listeners.get(type) ?? []) l({ data })
  }
}

const playing: RemoteState = {
  empty: false,
  name: 'clip.mp4',
  kind: 'video',
  playing: true,
  cur: 3,
  dur: 10,
  vol: 1,
  muted: false,
  rate: 1,
  canNext: true,
  canPrev: false
}

function fakeDeps(): ClientDeps & {
  sources: FakeSource[]
  fetches: { url: string; init: RequestInit }[]
  status: number
} {
  const d = {
    sources: [] as FakeSource[],
    fetches: [] as { url: string; init: RequestInit }[],
    status: 204,
    open: (url: string): StreamSource => {
      const s = new FakeSource(url)
      d.sources.push(s)
      return s
    },
    setTimeout: (cb: () => void, ms: number): unknown => setTimeout(cb, ms),
    clearTimeout: (h: unknown): void => clearTimeout(h as ReturnType<typeof setTimeout>),
    fetch: async (url: string, init: RequestInit): Promise<{ status: number }> => {
      d.fetches.push({ url, init })
      return { status: d.status }
    }
  }
  return d
}

beforeEach(() => {
  vi.useFakeTimers()
  writeToken('tok')
})
afterEach(() => {
  vi.useRealTimers()
  writeToken(null)
})

describe('parseFrame', () => {
  it('reads a state frame', () => {
    expect(parseFrame(JSON.stringify(playing))).toEqual(playing)
    expect(parseFrame(JSON.stringify(emptyState()))).toEqual(emptyState())
  })
  it('refuses what is not a state', () => {
    expect(parseFrame('soup')).toBeNull()
    expect(parseFrame('[1]')).toBeNull()
    expect(parseFrame('null')).toBeNull()
    expect(parseFrame(42)).toBeNull()
    expect(parseFrame(JSON.stringify({ ...playing, cur: 'three' }))).toBeNull()
    expect(parseFrame(JSON.stringify({ ...playing, kind: 'film' }))).toBeNull()
    expect(parseFrame(JSON.stringify({ ...playing, playing: 'yes' }))).toBeNull()
    const noName: Partial<RemoteState> = { ...playing }
    delete noName.name
    expect(parseFrame(JSON.stringify(noName))).toBeNull()
  })
})

describe('connect', () => {
  it('opens the stream with the token in the query and hands states on', () => {
    const d = fakeDeps()
    const states: RemoteState[] = []
    const downs: boolean[] = []
    const stop = connect(
      (s) => states.push(s),
      (x) => downs.push(x),
      d
    )
    expect(d.sources).toHaveLength(1)
    expect(d.sources[0].url).toBe('/remote/state?t=tok')
    d.sources[0].fire('open')
    expect(downs).toEqual([false])
    d.sources[0].fire('state', JSON.stringify(playing))
    d.sources[0].fire('state', 'not json')
    d.sources[0].fire('state', JSON.stringify({ ...playing, playing: false }))
    expect(states).toEqual([playing, { ...playing, playing: false }])
    stop()
    expect(d.sources[0].closed).toBe(true)
  })

  it('reconnects on its own clock after an error, backing off and resetting on open', () => {
    const d = fakeDeps()
    const downs: boolean[] = []
    const stop = connect(
      () => {},
      (x) => downs.push(x),
      d
    )
    d.sources[0].fire('open')
    d.sources[0].fire('error')
    expect(d.sources[0].closed).toBe(true)
    expect(downs).toEqual([false, true])
    // Nothing until the first backoff has run out.
    vi.advanceTimersByTime(999)
    expect(d.sources).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(d.sources).toHaveLength(2)
    // A second failure waits twice as long.
    d.sources[1].fire('error')
    vi.advanceTimersByTime(1999)
    expect(d.sources).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(d.sources).toHaveLength(3)
    // A connection that opens resets the clock: the next failure waits 1s again.
    d.sources[2].fire('open')
    expect(downs.at(-1)).toBe(false)
    d.sources[2].fire('error')
    vi.advanceTimersByTime(1000)
    expect(d.sources).toHaveLength(4)
    stop()
    expect(d.sources[3].closed).toBe(true)
  })

  it('a stopped client neither reconnects nor hears a late event', () => {
    const d = fakeDeps()
    const states: RemoteState[] = []
    const stop = connect(
      (s) => states.push(s),
      () => {},
      d
    )
    d.sources[0].fire('error')
    stop()
    vi.advanceTimersByTime(60_000)
    expect(d.sources).toHaveLength(1)
    // An event out of a source that was replaced is ignored too.
    const d2 = fakeDeps()
    const states2: RemoteState[] = []
    connect(
      (s) => states2.push(s),
      () => {},
      d2
    )
    d2.sources[0].fire('error')
    vi.advanceTimersByTime(1000)
    d2.sources[0].fire('state', JSON.stringify(playing))
    expect(states2).toEqual([])
    d2.sources[1].fire('state', JSON.stringify(playing))
    expect(states2).toEqual([playing])
  })
})

describe('send', () => {
  it('POSTs the command as JSON with the token and answers the status', async () => {
    const d = fakeDeps()
    expect(await send({ op: 'seek', to: 3 }, d)).toBe(204)
    expect(d.fetches).toHaveLength(1)
    expect(d.fetches[0].url).toBe('/remote/cmd?t=tok')
    expect(d.fetches[0].init.method).toBe('POST')
    expect(d.fetches[0].init.body).toBe('{"op":"seek","to":3}')
    d.status = 409
    expect(await send({ op: 'toggle' }, d)).toBe(409)
  })
  it('answers 0 when nothing answered', async () => {
    expect(
      await send(
        { op: 'play' },
        {
          fetch: () => Promise.reject(new Error('offline'))
        }
      )
    ).toBe(0)
  })
})

describe('shownClock', () => {
  it('carries a playing clock forward at the rate, capped at the end', () => {
    expect(shownClock(playing, 1000, 1500)).toBeCloseTo(3.5)
    expect(shownClock({ ...playing, rate: 2 }, 1000, 1500)).toBeCloseTo(4)
    expect(shownClock(playing, 1000, 60_000)).toBe(10)
    // A stream with no known end is not capped.
    expect(shownClock({ ...playing, dur: 0 }, 1000, 61_000)).toBeCloseTo(63)
  })
  it('leaves a paused clock where the report put it, and never runs backwards', () => {
    expect(shownClock({ ...playing, playing: false }, 1000, 5000)).toBe(3)
    expect(shownClock(playing, 5000, 1000)).toBe(3)
  })
})

describe('noticeFor', () => {
  it('names the answers a phone can get', () => {
    expect(noticeFor(204)).toBeNull()
    expect(noticeFor(409)).toBe('Nothing is playing on the PC')
    expect(noticeFor(401)).toBe('This PC forgot this phone')
    expect(noticeFor(0)).toBe('Could not reach Prism')
    expect(noticeFor(500)).toBe('Prism refused that (500)')
  })
})

describe('backoff', () => {
  it('doubles from a second and stops at fifteen', () => {
    expect([0, 1, 2, 3, 4, 9].map(backoff)).toEqual([1000, 2000, 4000, 8000, 15_000, 15_000])
  })
})
