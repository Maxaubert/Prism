import { describe, expect, it, vi } from 'vitest'
import {
  canFullscreen,
  enterFullscreen,
  exitFullscreen,
  fullscreenRoute,
  isFullscreen,
  onFullscreenChange,
  type FullscreenContainer,
  type FullscreenMedia
} from './fullscreen'

/** A listening thing: the fakes are plain objects, since these tests run
 *  under node and there is no document to reach for. */
function listeners(): {
  on: Map<string, Set<() => void>>
  addEventListener: (t: string, cb: () => void) => void
  removeEventListener: (t: string, cb: () => void) => void
  fire: (t: string) => void
  count: () => number
} {
  const on = new Map<string, Set<() => void>>()
  return {
    on,
    addEventListener: (t, cb) => {
      const s = on.get(t) ?? new Set()
      s.add(cb)
      on.set(t, s)
    },
    removeEventListener: (t, cb) => void on.get(t)?.delete(cb),
    fire: (t) => on.get(t)?.forEach((cb) => cb()),
    count: () => [...on.values()].reduce((n, s) => n + s.size, 0)
  }
}

/** A host with the standard API: Chrome, Edge, Firefox, and Safari on a Mac. */
function standardHost(): { doc: Record<string, unknown>; el: FullscreenContainer } {
  const doc = { ...listeners(), fullscreenEnabled: true, fullscreenElement: null } as Record<
    string,
    unknown
  >
  doc.exitFullscreen = vi.fn(() => {
    doc.fullscreenElement = null
    return Promise.resolve()
  })
  const el = {
    ownerDocument: doc,
    requestFullscreen: vi.fn(() => {
      doc.fullscreenElement = el
      return Promise.resolve()
    })
  }
  return { doc, el: el as unknown as FullscreenContainer }
}

/** An older WebKit on a desktop or an iPad: the prefixed element route. */
function webkitHost(): { doc: Record<string, unknown>; el: FullscreenContainer } {
  const doc = {
    ...listeners(),
    webkitFullscreenEnabled: true,
    webkitFullscreenElement: null
  } as Record<string, unknown>
  doc.webkitExitFullscreen = vi.fn(() => {
    doc.webkitFullscreenElement = null
  })
  const el = {
    ownerDocument: doc,
    webkitRequestFullscreen: vi.fn(() => {
      doc.webkitFullscreenElement = el
    })
  }
  return { doc, el: el as unknown as FullscreenContainer }
}

/** An iPhone: no element and no document fullscreen anywhere, only the
 *  media element's own native player. */
function iphone(): {
  el: FullscreenContainer
  video: FullscreenMedia & { l: ReturnType<typeof listeners> }
} {
  const doc = { ...listeners() }
  const l = listeners()
  const video = {
    ...l,
    l,
    webkitDisplayingFullscreen: false,
    webkitEnterFullscreen: vi.fn(() => {
      video.webkitDisplayingFullscreen = true
    }),
    webkitExitFullscreen: vi.fn(() => {
      video.webkitDisplayingFullscreen = false
    })
  }
  return {
    el: { ownerDocument: doc } as unknown as FullscreenContainer,
    video: video as unknown as FullscreenMedia & { l: ReturnType<typeof listeners> }
  }
}

describe('picking a fullscreen route', () => {
  it('takes the standard API when the host has it', () => {
    const { el } = standardHost()
    expect(fullscreenRoute(el, null)).toBe('standard')
    expect(canFullscreen(el, null)).toBe(true)
  })
  it('takes the standard API over the media element, since the page can go with it', () => {
    // A phone with both (an Android) keeps the page's own fullscreen: the
    // OS player would hide the transport, the target control and the way back.
    const { el } = standardHost()
    const { video } = iphone()
    expect(fullscreenRoute(el, video)).toBe('standard')
  })
  it('falls back to the prefixed element route', () => {
    const { el } = webkitHost()
    expect(fullscreenRoute(el, null)).toBe('webkit-element')
  })
  it('takes the media element on an iPhone, which has nothing else', () => {
    const { el, video } = iphone()
    expect(fullscreenRoute(el, video)).toBe('ios-media')
    expect(canFullscreen(el, video)).toBe(true)
  })
  it('is none on an iPhone with no media element, which is a picture or a page', () => {
    const { el } = iphone()
    expect(fullscreenRoute(el, null)).toBe('none')
    expect(canFullscreen(el, null)).toBe(false)
  })
  it('refuses a document that says fullscreen is not allowed here', () => {
    // An iframe without the permission answers `fullscreenEnabled` false and
    // rejects the request; the media route still works there.
    const { el, doc } = standardHost()
    doc.fullscreenEnabled = false
    const { video } = iphone()
    expect(fullscreenRoute(el, null)).toBe('none')
    expect(fullscreenRoute(el, video)).toBe('ios-media')
  })
})

describe('entering and leaving', () => {
  it('asks the element on the standard route, and the document to leave', () => {
    const { el, doc } = standardHost()
    expect(enterFullscreen(el, null)).toBe('standard')
    expect(isFullscreen(el, null)).toBe(true)
    expect(exitFullscreen(el, null)).toBe('standard')
    expect(doc.exitFullscreen).toHaveBeenCalled()
    expect(isFullscreen(el, null)).toBe(false)
  })
  it('uses the prefixed pair where that is what there is', () => {
    const { el, doc } = webkitHost()
    expect(enterFullscreen(el, null)).toBe('webkit-element')
    expect(isFullscreen(el, null)).toBe(true)
    expect(exitFullscreen(el, null)).toBe('webkit-element')
    expect(doc.webkitExitFullscreen).toHaveBeenCalled()
    expect(isFullscreen(el, null)).toBe(false)
  })
  it('hands an iPhone its native player, and takes it back', () => {
    const { el, video } = iphone()
    expect(enterFullscreen(el, video)).toBe('ios-media')
    expect(video.webkitEnterFullscreen).toHaveBeenCalled()
    expect(isFullscreen(el, video)).toBe(true)
    expect(exitFullscreen(el, video)).toBe('ios-media')
    expect(isFullscreen(el, video)).toBe(false)
  })
  it('does nothing, quietly, where there is no route at all', () => {
    const { el } = iphone()
    expect(enterFullscreen(el, null)).toBe('none')
    expect(exitFullscreen(el, null)).toBe('none')
    expect(isFullscreen(el, null)).toBe(false)
  })
  it('swallows a rejected request rather than leaving it unhandled', async () => {
    // Every browser rejects a request that did not come from a gesture, and
    // an unhandled rejection in the phone page is a red console on a device
    // with no console to read.
    const { el } = standardHost()
    const container = el as unknown as { requestFullscreen: () => Promise<void> }
    container.requestFullscreen = () => Promise.reject(new Error('not from a gesture'))
    expect(() => enterFullscreen(el, null)).not.toThrow()
    await Promise.resolve()
  })
})

describe('hearing about a change', () => {
  it('hears the document, whichever spelling it uses', () => {
    const { el, doc } = standardHost()
    const cb = vi.fn()
    const off = onFullscreenChange(el, null, cb)
    ;(doc as unknown as { fire: (t: string) => void }).fire('fullscreenchange')
    ;(doc as unknown as { fire: (t: string) => void }).fire('webkitfullscreenchange')
    expect(cb).toHaveBeenCalledTimes(2)
    off()
    expect((doc as unknown as { count: () => number }).count()).toBe(0)
  })
  it('hears the media element begin and end its own fullscreen', () => {
    // The iPhone's OS player is left with a swipe or the Done button, and
    // neither is a document event: without these two the phone's own state
    // would say fullscreen for ever and the header would never come back.
    const { el, video } = iphone()
    const cb = vi.fn()
    const off = onFullscreenChange(el, video, cb)
    video.l.fire('webkitbeginfullscreen')
    video.l.fire('webkitendfullscreen')
    expect(cb).toHaveBeenCalledTimes(2)
    off()
    expect(video.l.count()).toBe(0)
  })
  it('unsubscribes everything it subscribed, on both halves at once', () => {
    const { el, doc } = standardHost()
    const { video } = iphone()
    const off = onFullscreenChange(el, video, vi.fn())
    expect((doc as unknown as { count: () => number }).count()).toBeGreaterThan(0)
    expect(video.l.count()).toBeGreaterThan(0)
    off()
    expect((doc as unknown as { count: () => number }).count()).toBe(0)
    expect(video.l.count()).toBe(0)
  })
  it('survives a host with nothing to listen to', () => {
    const off = onFullscreenChange({} as FullscreenContainer, null, vi.fn())
    expect(() => off()).not.toThrow()
  })
})
