import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThumbsReady } from '@shared/thumbTypes'
import { createThumbsEndpoint, type ThumbsLike } from './thumbsEndpoint'

/**
 * thumbs:want / thumbs:ready / thumbs:cancel (Stage 2), without Electron: the
 * endpoint is handed a pretend Thumbs, the wall's two guards and a sink for
 * each window. What it must do: refuse silently anything the Explorer did not
 * list for THIS tab, answer hits at once, queue the rest, batch what main
 * makes every 50 ms, and drop a stale ask.
 */
const cache = 'C:\\cache\\'
const nameOf = (f: string): string => `${f.replace(/[^a-z0-9]/gi, '').padEnd(40, '0').slice(0, 40).toLowerCase()}.jpg`

interface Setup {
  hits: Set<string>
  failed: Set<string>
  made: string[]
  inLookup: { now: number; peak: number }
  thumbs: ThumbsLike
  sent: Array<{ sink: number; msg: ThumbsReady }>
  ep: ReturnType<typeof createThumbsEndpoint>
  sink: (id: number, alive?: () => boolean) => { id: number; alive: () => boolean; send: (m: ThumbsReady) => void }
  finishMake: (() => void)[]
}

function setup(opts: { owns?: (tab: string, p: string) => boolean; readable?: (p: string) => boolean; hold?: boolean } = {}): Setup {
  const s: Setup = {
    hits: new Set(),
    failed: new Set(),
    made: [],
    inLookup: { now: 0, peak: 0 },
    sent: [],
    finishMake: [],
    thumbs: undefined as never,
    ep: undefined as never,
    sink: undefined as never
  }
  s.thumbs = {
    lookup: async (file) => {
      s.inLookup.now += 1
      s.inLookup.peak = Math.max(s.inLookup.peak, s.inLookup.now)
      await new Promise((r) => setImmediate(r))
      s.inLookup.now -= 1
      if (s.failed.has(file)) return { failed: true }
      return s.hits.has(file) ? { file: cache + nameOf(file) } : null
    },
    makeFor: (file) =>
      new Promise((resolve) => {
        s.made.push(file)
        const done = (): void => resolve(file.includes('bad') ? null : cache + nameOf(file))
        if (opts.hold) s.finishMake.push(done)
        else done()
      })
  }
  s.sink = (id, alive = () => true) => ({ id, alive, send: (msg) => void s.sent.push({ sink: id, msg }) })
  s.ep = createThumbsEndpoint({
    thumbs: s.thumbs,
    readable: opts.readable ?? (() => true),
    owns: opts.owns ?? (() => true),
    cores: () => 16
  })
  return s
}

const wants = (paths: string[], tier: 320 | 640 = 320): Array<{ path: string; tier: 320 | 640 }> =>
  paths.map((path) => ({ path, tier }))
const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r))
}

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }))
afterEach(() => vi.useRealTimers())

describe('thumbs:want', () => {
  it('answers a cache hit and a remembered failure at once, and queues the rest', async () => {
    const s = setup({ hold: true })
    s.hits.add('C:\\f\\hit.jpg')
    s.failed.add('C:\\f\\broken.jpg')
    const r = await s.ep.want(s.sink(1), 'tab', 1, wants(['C:\\f\\hit.jpg', 'C:\\f\\broken.jpg', 'C:\\f\\new.jpg']))
    expect(r.ready).toEqual({
      'C:\\f\\hit.jpg': `fsmedia://thumb/${nameOf('C:\\f\\hit.jpg')}`,
      'C:\\f\\broken.jpg': null
    })
    await flush()
    expect(s.made).toEqual(['C:\\f\\new.jpg'])
  })

  it('delivers what main makes as fsmedia://thumb urls, batched, under the ask generation; null for no picture', async () => {
    const s = setup()
    await s.ep.want(s.sink(1), 'tab', 4, wants(['C:\\f\\a.jpg', 'C:\\f\\bad.png', 'C:\\f\\c.mp4']))
    await flush()
    expect(s.sent).toHaveLength(0)
    vi.advanceTimersByTime(50)
    expect(s.sent).toHaveLength(1)
    const { gen, results } = s.sent[0].msg
    expect(gen).toBe(4)
    expect(results).toEqual([
      { path: 'C:\\f\\a.jpg', url: `fsmedia://thumb/${nameOf('C:\\f\\a.jpg')}` },
      { path: 'C:\\f\\bad.png', url: null },
      { path: 'C:\\f\\c.mp4', url: `fsmedia://thumb/${nameOf('C:\\f\\c.mp4')}` }
    ])
  })

  it('ignores, silently, a path outside the roots', async () => {
    const s = setup({ readable: (p) => p.startsWith('C:\\f\\') })
    const r = await s.ep.want(s.sink(1), 'tab', 1, wants(['D:\\elsewhere\\a.jpg', 'C:\\f\\ok.jpg']))
    await flush()
    expect(r.ready).toEqual({})
    expect(s.made).toEqual(['C:\\f\\ok.jpg'])
  })

  it('resolves the paths off main\'s thread before the guards read them', async () => {
    const order: string[] = []
    const s = setup({ readable: () => (order.push('guard'), true) })
    const ep = createThumbsEndpoint({
      thumbs: s.thumbs,
      readable: () => (order.push('guard'), true),
      owns: () => true,
      cores: () => 16,
      warm: async (paths) => void order.push(`warm ${paths.join(',')}`)
    })
    await ep.want(s.sink(1), 'tab', 1, wants(['C:\\f\\a.jpg']))
    expect(order[0]).toBe('warm C:\\f\\a.jpg,C:\\f')
    expect(order.slice(1)).toEqual(['guard'])
  })

  it('ignores a path that is not a direct entry of a folder THIS tab visited', async () => {
    const owns = vi.fn((tab: string, p: string) => tab === 'mine' && p.startsWith('C:\\mine\\'))
    const s = setup({ owns })
    await s.ep.want(s.sink(1), 'mine', 1, wants(['C:\\mine\\a.jpg', 'C:\\other\\b.jpg', 'C:\\mine\\deep\\c.jpg'.replace('deep\\', '')]))
    await s.ep.want(s.sink(1), 'theirs', 1, wants(['C:\\mine\\d.jpg']))
    await flush()
    expect(s.made.sort()).toEqual(['C:\\mine\\a.jpg', 'C:\\mine\\c.jpg'])
  })

  it('an archive member is a path the wall may know but no file on disk: it is not asked of Thumbs', async () => {
    const s = setup({ owns: (_t, p) => !p.includes('.zip\\') })
    await s.ep.want(s.sink(1), 'tab', 1, wants(['C:\\f\\pack.zip\\inside.jpg']))
    await flush()
    expect(s.made).toEqual([])
  })

  it('makes no picture of what is not a photo or a film: text, pdf, audio, archives, svg', async () => {
    const s = setup()
    const r = await s.ep.want(
      s.sink(1),
      'tab',
      1,
      wants(['C:\\f\\a.txt', 'C:\\f\\a.pdf', 'C:\\f\\a.mp3', 'C:\\f\\a.zip', 'C:\\f\\a.svg', 'C:\\f\\Dockerfile', 'C:\\f\\folder'])
    )
    await flush()
    expect(r.ready).toEqual({})
    expect(s.made).toEqual([])
  })

  it('takes images, raws, HEIC and every film kind, mov included', async () => {
    const s = setup()
    const names = ['a.jpg', 'a.PNG', 'a.gif', 'a.webp', 'a.avif', 'a.heic', 'a.cr2', 'a.mov', 'a.mp4', 'a.mkv', 'a.webm', 'a.avi']
    await s.ep.want(s.sink(1), 'tab', 1, wants(names.map((n) => `C:\\f\\${n}`)))
    await flush()
    expect(s.made).toHaveLength(names.length)
  })

  it('throws away malformed asks instead of failing', async () => {
    const s = setup()
    const sink = s.sink(1)
    const bad = [
      [null, 1, []],
      ['tab', 'x', []],
      ['tab', 1, 'nope'],
      ['tab', 1, [null, 5, { path: 3, tier: 320 }, { path: 'C:\\f\\a.jpg', tier: 999 }, { path: 'C:\\f\\a.jpg' }]]
    ] as unknown as Array<[string, number, never]>
    for (const [tab, gen, items] of bad) expect(await s.ep.want(sink, tab, gen, items)).toEqual({ ready: {} })
    await flush()
    expect(s.made).toEqual([])
  })

  it('caps one ask at 400 files', async () => {
    const s = setup()
    await s.ep.want(s.sink(1), 'tab', 1, wants(Array.from({ length: 900 }, (_, i) => `C:\\f\\${i}.jpg`)))
    await flush()
    vi.advanceTimersByTime(60)
    await flush()
    vi.advanceTimersByTime(60)
    expect(s.made.length).toBeLessThanOrEqual(400)
  })

  it('never has more than 8 cache probes in flight', async () => {
    const s = setup()
    await s.ep.want(s.sink(1), 'tab', 1, wants(Array.from({ length: 100 }, (_, i) => `C:\\f\\${i}.jpg`)))
    expect(s.inLookup.peak).toBeLessThanOrEqual(8)
    expect(s.inLookup.peak).toBeGreaterThan(1)
  })

  it('a newer ask from the tab that arrives while the first is still probing queues only the newer', async () => {
    const s = setup({ hold: true })
    const first = s.ep.want(s.sink(1), 'tab', 1, wants(['C:\\f\\old.jpg']))
    const second = s.ep.want(s.sink(1), 'tab', 2, wants(['C:\\f\\new.jpg']))
    await Promise.all([first, second])
    await flush()
    expect(s.made).toEqual(['C:\\f\\new.jpg'])
  })

  it('a send to a window that is gone is dropped', async () => {
    const s = setup()
    let alive = true
    await s.ep.want(s.sink(1, () => alive), 'tab', 1, wants(['C:\\f\\a.jpg']))
    await flush()
    alive = false
    vi.advanceTimersByTime(60)
    expect(s.sent).toHaveLength(0)
  })

  it('cancel drops the tab: what waits is not made and nothing is sent', async () => {
    const s = setup({ hold: true })
    await s.ep.want(s.sink(1), 'tab', 1, wants(Array.from({ length: 10 }, (_, i) => `C:\\f\\${i}.jpg`)))
    await flush()
    const started = s.made.length
    expect(started).toBeLessThan(10)
    s.ep.cancel('tab')
    s.finishMake.splice(0).forEach((f) => f())
    await flush()
    vi.advanceTimersByTime(60)
    expect(s.made.length).toBe(started)
    expect(s.sent).toHaveLength(0)
  })

  it('while a film plays the desktop has one slot', async () => {
    const s = setup({ hold: true })
    s.ep.film(1, true)
    await s.ep.want(s.sink(1), 'tab', 1, wants(['C:\\f\\a.jpg', 'C:\\f\\b.jpg', 'C:\\f\\c.jpg']))
    await flush()
    expect(s.made).toHaveLength(1)
    s.ep.film(1, false)
    await flush()
    expect(s.made).toHaveLength(3)
  })

  it('forgets a window\'s film when the window goes', async () => {
    const s = setup({ hold: true })
    s.ep.film(7, true)
    s.ep.forgetSender(7)
    await s.ep.want(s.sink(1), 'tab', 1, wants(['C:\\f\\a.jpg', 'C:\\f\\b.jpg', 'C:\\f\\c.jpg']))
    await flush()
    expect(s.made).toHaveLength(3)
  })
})
