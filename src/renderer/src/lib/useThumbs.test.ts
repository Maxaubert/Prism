import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThumbWant, ThumbsReady, ThumbsWantReply } from '@shared/thumbTypes'
import { createThumbFeed, type ThumbsApi } from './useThumbs'

const item = (name: string, tier: 320 | 640 = 320): ThumbWant => ({ path: `C:\\x\\${name}`, tier })
const P = (name: string): string => `C:\\x\\${name}`

function fakeApi(reply: (gen: number, items: ThumbWant[]) => ThumbsWantReply = () => ({ ready: {} })) {
  let push: ((m: ThumbsReady) => void) | null = null
  const api = {
    want: vi.fn(async (_tab: string, gen: number, items: ThumbWant[]) => reply(gen, items)),
    cancel: vi.fn(),
    onReady: vi.fn((cb: (m: ThumbsReady) => void) => {
      push = cb
      return () => {
        push = null
      }
    })
  }
  return { api: api as unknown as ThumbsApi & typeof api, push: (m: ThumbsReady) => push?.(m) }
}

// The renderer half of the thumbnail asks (zoom grid, Stage 3, spec 4.5): it
// asks only after the list has settled, drops stale answers, remembers a
// "no picture", and asks for nothing while a hold, a hidden tab or a smaller
// zoom step is on.
describe('createThumbFeed', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sends nothing while the visible set keeps changing, one want when it stops', async () => {
    const { api } = fakeApi()
    const feed = createThumbFeed(api, 'tab1')
    feed.visible([item('a.jpg')])
    await vi.advanceTimersByTimeAsync(80)
    feed.visible([item('b.jpg')])
    await vi.advanceTimersByTimeAsync(80)
    feed.visible([item('c.jpg')])
    await vi.advanceTimersByTimeAsync(119)
    expect(api.want).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2)
    expect(api.want).toHaveBeenCalledTimes(1)
    expect(api.want.mock.calls[0][0]).toBe('tab1')
    expect(api.want.mock.calls[0][2]).toEqual([item('c.jpg')])
  })

  it('the same set again does not push the settle back', async () => {
    const { api } = fakeApi()
    const feed = createThumbFeed(api, 't')
    feed.visible([item('a.jpg')])
    await vi.advanceTimersByTimeAsync(100)
    feed.visible([item('a.jpg')])
    await vi.advanceTimersByTimeAsync(25)
    expect(api.want).toHaveBeenCalledTimes(1)
  })

  it('applies the cache hits and remembered failures of the reply at once', async () => {
    const { api } = fakeApi(() => ({ ready: { [P('a.jpg')]: 'fsmedia://thumb/a.jpg', [P('bad.jpg')]: null } }))
    const feed = createThumbFeed(api, 't')
    const seen = vi.fn()
    feed.subscribe(seen)
    feed.visible([item('a.jpg'), item('bad.jpg'), item('c.jpg')])
    await vi.advanceTimersByTimeAsync(130)
    expect(feed.get(P('a.jpg'))).toBe('fsmedia://thumb/a.jpg')
    expect(feed.get(P('bad.jpg'))).toBeNull()
    expect(feed.get(P('c.jpg'))).toBeUndefined()
    expect(seen).toHaveBeenCalled()
  })

  it('takes pushed results of the current generation and ignores older ones', async () => {
    const { api, push } = fakeApi()
    const feed = createThumbFeed(api, 't')
    feed.visible([item('a.jpg')])
    await vi.advanceTimersByTimeAsync(130)
    const gen1 = api.want.mock.calls[0][1]
    feed.visible([item('b.jpg')])
    await vi.advanceTimersByTimeAsync(130)
    const gen2 = api.want.mock.calls[1][1]
    expect(gen2).toBeGreaterThan(gen1)
    push({ gen: gen1, results: [{ path: P('b.jpg'), url: 'fsmedia://thumb/old.jpg' }] })
    expect(feed.get(P('b.jpg'))).toBeUndefined()
    push({ gen: gen2, results: [{ path: P('b.jpg'), url: 'fsmedia://thumb/b.jpg' }] })
    expect(feed.get(P('b.jpg'))).toBe('fsmedia://thumb/b.jpg')
  })

  it('remembers a null and never asks for that path again', async () => {
    const { api, push } = fakeApi()
    const feed = createThumbFeed(api, 't')
    feed.visible([item('bad.jpg')])
    await vi.advanceTimersByTimeAsync(130)
    push({ gen: api.want.mock.calls[0][1], results: [{ path: P('bad.jpg'), url: null }] })
    expect(feed.get(P('bad.jpg'))).toBeNull()
    feed.visible([item('bad.jpg'), item('d.jpg')])
    await vi.advanceTimersByTimeAsync(130)
    expect(api.want.mock.calls[1][2]).toEqual([item('d.jpg')])
    feed.visible([item('bad.jpg')])
    await vi.advanceTimersByTimeAsync(130)
    expect(api.want).toHaveBeenCalledTimes(2)
  })

  it('asks again for a bigger tier than the one it holds', async () => {
    const { api, push } = fakeApi()
    const feed = createThumbFeed(api, 't')
    feed.visible([item('a.jpg', 320)])
    await vi.advanceTimersByTimeAsync(130)
    push({ gen: api.want.mock.calls[0][1], results: [{ path: P('a.jpg'), url: 'fsmedia://thumb/s.jpg' }] })
    feed.visible([item('a.jpg', 640)])
    await vi.advanceTimersByTimeAsync(130)
    expect(api.want.mock.calls[1][2]).toEqual([item('a.jpg', 640)])
    expect(feed.get(P('a.jpg'))).toBe('fsmedia://thumb/s.jpg')
  })

  it('a hold sends nothing and cancels; lifting it asks again after a settle', async () => {
    const { api } = fakeApi()
    const feed = createThumbFeed(api, 't')
    feed.visible([item('a.jpg')])
    feed.setActive(false)
    expect(api.cancel).toHaveBeenCalledWith('t')
    await vi.advanceTimersByTimeAsync(500)
    expect(api.want).not.toHaveBeenCalled()
    feed.visible([item('a.jpg'), item('b.jpg')])
    await vi.advanceTimersByTimeAsync(500)
    expect(api.want).not.toHaveBeenCalled()
    feed.setActive(true)
    await vi.advanceTimersByTimeAsync(119)
    expect(api.want).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2)
    expect(api.want).toHaveBeenCalledTimes(1)
    expect(api.want.mock.calls[0][2]).toEqual([item('a.jpg'), item('b.jpg')])
  })

  it('a reply that lands after a reset is dropped', async () => {
    let release: (r: ThumbsWantReply) => void = () => {}
    const { api } = fakeApi()
    api.want.mockImplementationOnce(
      () =>
        new Promise<ThumbsWantReply>((r) => {
          release = r
        })
    )
    const feed = createThumbFeed(api, 't')
    feed.visible([item('a.jpg')])
    await vi.advanceTimersByTimeAsync(130)
    feed.reset()
    release({ ready: { [P('a.jpg')]: 'fsmedia://thumb/a.jpg' } })
    await vi.advanceTimersByTimeAsync(0)
    expect(feed.get(P('a.jpg'))).toBeUndefined()
  })

  it('a new folder clears the map and cancels', async () => {
    const { api } = fakeApi(() => ({ ready: { [P('a.jpg')]: 'fsmedia://thumb/a.jpg' } }))
    const feed = createThumbFeed(api, 't')
    feed.visible([item('a.jpg')])
    await vi.advanceTimersByTimeAsync(130)
    expect(feed.get(P('a.jpg'))).toBe('fsmedia://thumb/a.jpg')
    feed.reset()
    expect(api.cancel).toHaveBeenCalledWith('t')
    expect(feed.get(P('a.jpg'))).toBeUndefined()
  })

  it('an empty visible set asks for nothing, and dispose stops the timer', async () => {
    const { api } = fakeApi()
    const feed = createThumbFeed(api, 't')
    feed.visible([])
    await vi.advanceTimersByTimeAsync(300)
    expect(api.want).not.toHaveBeenCalled()
    feed.visible([item('a.jpg')])
    feed.dispose()
    await vi.advanceTimersByTimeAsync(300)
    expect(api.want).not.toHaveBeenCalled()
    expect(api.cancel).toHaveBeenCalledWith('t')
  })
})
