import { afterEach, describe, expect, it, vi } from 'vitest'

// The desktop's thumbnails give way to a playing film (spec 4.3, decision 12):
// main counts per window who plays; the page that knows is this one, the same
// answer that keeps the screen awake.
describe('who is playing tells the thumbnails too', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('says a film started and stopped to the thumbnail queue, once per change', async () => {
    vi.resetModules()
    const film = vi.fn()
    const setAwake = vi.fn()
    vi.stubGlobal('window', { prism: { setAwake, thumbs: { film } } })
    const { reportPlaying, forgetPlayer } = await import('./awake')
    reportPlaying('a', true)
    reportPlaying('b', true)
    expect(film.mock.calls).toEqual([[true]])
    forgetPlayer('a')
    expect(film.mock.calls).toEqual([[true]])
    forgetPlayer('b')
    expect(film.mock.calls).toEqual([[true], [false]])
    expect(setAwake.mock.calls).toEqual([[true], [false]])
  })

  it('a host with no thumbnails (the phone) is fine', async () => {
    vi.resetModules()
    vi.stubGlobal('window', { prism: { setAwake: vi.fn() } })
    const { reportPlaying } = await import('./awake')
    expect(() => reportPlaying('a', true)).not.toThrow()
  })
})
