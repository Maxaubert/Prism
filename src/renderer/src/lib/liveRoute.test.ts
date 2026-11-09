import { describe, expect, it } from 'vitest'
import { AUTOSTART_MS, BLACK_MS, NO_PICTURE_MS, SLOW_LOAD_MS, autostartCheck, blackCheck, blackReadings, filmErrorShows, hevcMime, isPlatformCodec, pictureCheck, pictureRoute, rescueLive, routeWhy } from './liveRoute'

/** A PC that answers `canPlayType` with `yes` for exactly these mimes. */
const pc =
  (...yes: string[]) =>
  (mime: string): string =>
    yes.includes(mime) ? 'probably' : ''
const MAIN = 'video/mp4; codecs="hvc1.1.6.L120.90"'
const MAIN10 = 'video/mp4; codecs="hvc1.2.4.L120.90"'

describe('a film never stays black (owner, 2026-11-08)', () => {
  const pc2 = (m: string): string => (m === 'x' ? 'y' : '')
  it('a picture is ok, however late', () => {
    expect(pictureCheck({ elapsedMs: 100, readyState: 2, videoWidth: 1080 })).toBe('picture')
    expect(pictureCheck({ elapsedMs: 60_000, readyState: 4, videoWidth: 1080 })).toBe('picture')
  })

  it('no picture: waits, then gives up at the bound, error or no error', () => {
    expect(pictureCheck({ elapsedMs: 100, readyState: 0, videoWidth: 0 })).toBe('wait')
    expect(pictureCheck({ elapsedMs: NO_PICTURE_MS - 1, readyState: 0, videoWidth: 0 })).toBe('wait')
    expect(pictureCheck({ elapsedMs: NO_PICTURE_MS, readyState: 0, videoWidth: 0 })).toBe('no-picture')
    // Data arrived and still no width: the decoder said nothing.
    expect(pictureCheck({ elapsedMs: NO_PICTURE_MS, readyState: 2, videoWidth: 0 })).toBe('no-picture')
    // Width without a frame's worth of data is not a picture yet.
    expect(pictureCheck({ elapsedMs: NO_PICTURE_MS, readyState: 1, videoWidth: 1080 })).toBe('no-picture')
  })

  it('a picture once seen is never lost: a seek drops readyState for a moment', () => {
    expect(pictureCheck({ elapsedMs: 60_000, readyState: 1, videoWidth: 1080, seen: true })).toBe('picture')
  })

  it('a source that has not sent a byte gets longer than a decoder that said nothing', () => {
    const loading = { readyState: 0, videoWidth: 0, networkState: 2 }
    expect(pictureCheck({ ...loading, elapsedMs: NO_PICTURE_MS })).toBe('wait')
    expect(pictureCheck({ ...loading, elapsedMs: SLOW_LOAD_MS })).toBe('no-picture')
    // The empty player the owner saw: nothing is loading, so no long wait.
    expect(pictureCheck({ ...loading, networkState: 0, elapsedMs: NO_PICTURE_MS })).toBe('no-picture')
    // Metadata came and no frame followed: the decoder, at the short bound.
    expect(pictureCheck({ ...loading, readyState: 1, elapsedMs: NO_PICTURE_MS })).toBe('no-picture')
  })

  it('a film opening on black is not a dead decoder: five seconds, or most of a short clip', () => {
    expect(blackReadings(120)).toBe(BLACK_MS / 500)
    expect(blackReadings(undefined)).toBe(BLACK_MS / 500)
    expect(blackReadings(Number.NaN)).toBe(BLACK_MS / 500)
    // The owner's 2.87 s clip: called while it is still playing.
    expect(blackReadings(2.87)).toBe(4)
    expect(blackReadings(0.5)).toBe(2)
    const at = { platform: true, playing: true, t: 1, frames: 30, lit: 0, duration: 120 }
    expect(blackCheck({ ...at, hits: 2 }).verdict).toBe('unknown')
    expect(blackCheck({ ...at, hits: BLACK_MS / 500 - 1 }).verdict).toBe('black')
  })

  it('a black film is black readings while it plays, on the platform decoder only', () => {
    const at = { platform: true, playing: true, t: 1, frames: 30, lit: 0, hits: 0, duration: 1.5 }
    const once = blackCheck(at)
    expect(once).toEqual({ hits: 1, verdict: 'unknown' })
    expect(blackCheck({ ...at, hits: once.hits })).toEqual({ hits: 2, verdict: 'black' })
    expect(blackCheck({ ...at, lit: 50, hits: 1 })).toEqual({ hits: 0, verdict: 'lit' })
    expect(blackCheck({ ...at, platform: false, hits: 1 }).verdict).toBe('unknown')
    expect(blackCheck({ ...at, playing: false, hits: 1 }).verdict).toBe('unknown')
    expect(blackCheck({ ...at, t: 0.1, hits: 1 }).verdict).toBe('unknown')
    expect(blackCheck({ ...at, frames: 0, hits: 1 }).verdict).toBe('unknown')
    expect(blackCheck({ ...at, lit: null, hits: 1 }).verdict).toBe('unknown')
  })

  it('the route says why', () => {
    const base = { converting: false, canPlay: pc2 }
    expect(routeWhy({ ...base })).toBe('no-video-stream')
    expect(routeWhy({ ...base, codec: 'hevc', forceLive: true })).toBe('forced')
    expect(routeWhy({ ...base, codec: 'hevc', converting: true })).toBe('converting')
    expect(routeWhy({ ...base, codec: 'hevc' })).toBe('hevc-no')
    expect(routeWhy({ ...base, codec: 'hevc', canPlay: () => 'probably' })).toBe('hevc-yes')
    expect(routeWhy({ ...base, codec: 'h264' })).toBe('chromium-codec')
    expect(isPlatformCodec('HEVC')).toBe(true)
    expect(isPlatformCodec('h264')).toBe(false)
    expect(isPlatformCodec(undefined)).toBe(false)
  })
})

describe('pictureRoute (owner, 2026-11-08: the iPhone .mov films)', () => {
  it('asks about THIS film’s HEVC profile', () => {
    expect(hevcMime('Main')).toBe(MAIN)
    expect(hevcMime('Main 10')).toBe(MAIN10)
    expect(hevcMime(undefined)).toBe(MAIN)
    expect(hevcMime('Rext')).toContain('hvc1.4.')
  })

  it('a PC that decodes HEVC plays the file as it is: no transcode', () => {
    const r = pictureRoute({ codec: 'hevc', profile: 'Main', converting: false, canPlay: pc(MAIN, MAIN10) })
    expect(r).toBe('direct')
  })

  it('a PC that does not takes the live transcode', () => {
    expect(pictureRoute({ codec: 'hevc', profile: 'Main', converting: false, canPlay: pc() })).toBe('live')
  })

  it('Main and Main 10 are separate answers', () => {
    const only8 = pc(MAIN)
    expect(pictureRoute({ codec: 'hevc', profile: 'Main', converting: false, canPlay: only8 })).toBe('direct')
    expect(pictureRoute({ codec: 'HEVC', profile: 'Main 10', converting: false, canPlay: only8 })).toBe('live')
  })

  it('codecs Chromium decodes itself are never asked about', () => {
    for (const codec of ['h264', 'vp9', 'av1', 'vp8'])
      expect(pictureRoute({ codec, converting: false, canPlay: pc() })).toBe('direct')
  })

  it('a film main is converting stays on that route, audio has no picture to route', () => {
    expect(pictureRoute({ codec: 'mpeg2video', converting: true, canPlay: pc() })).toBe('direct')
    expect(pictureRoute({ codec: undefined, converting: false, canPlay: pc() })).toBe('direct')
  })

  it('the e2e can force the live route on any film with a picture', () => {
    expect(pictureRoute({ codec: 'h264', forceLive: true, converting: false, canPlay: pc() })).toBe('live')
    expect(pictureRoute({ codec: undefined, forceLive: true, converting: false, canPlay: pc() })).toBe('direct')
  })
})

describe('rescueLive: the element has the last word', () => {
  const base = { codec: 'hevc', tried: false, converting: false, converted: false, failed: false, readyState: 4, videoWidth: 1920 }
  it('a film that plays its picture stays direct', () => {
    expect(rescueLive(base)).toBe(false)
  })
  it('an error, or a frame’s worth of data and no picture, goes live', () => {
    expect(rescueLive({ ...base, failed: true, readyState: 0, videoWidth: 0 })).toBe(true)
    expect(rescueLive({ ...base, readyState: 2, videoWidth: 0 })).toBe(true)
  })
  it('not before there is data to judge by', () => {
    expect(rescueLive({ ...base, readyState: 1, videoWidth: 0 })).toBe(false)
  })
  it('once, never for a converted copy or a file with no picture', () => {
    const blind = { ...base, readyState: 2, videoWidth: 0 }
    expect(rescueLive({ ...blind, tried: true })).toBe(false)
    expect(rescueLive({ ...blind, converted: true })).toBe(false)
    expect(rescueLive({ ...blind, converting: true })).toBe(false)
    expect(rescueLive({ ...blind, codec: null })).toBe(false)
  })
})

describe('filmErrorShows: an error only when nothing is left to try (2026-11-09)', () => {
  const direct = { hasError: true, phone: false, probed: true, hasPicture: true, tried: false, converting: false, converted: false }
  it('says nothing while a refused film is about to go live', () => {
    expect(filmErrorShows(direct)).toBe(false)
  })
  it('says nothing before the probe has answered, as on the owner\'s PC', () => {
    expect(filmErrorShows({ ...direct, probed: false, hasPicture: false })).toBe(false)
  })
  it('says so once the live route has been tried', () => {
    expect(filmErrorShows({ ...direct, tried: true })).toBe(true)
  })
  it('says nothing while a conversion runs, whatever the original refused', () => {
    expect(filmErrorShows({ ...direct, converting: true, tried: true })).toBe(false)
  })
  it('says so for a file with no picture to rescue, once it is known', () => {
    expect(filmErrorShows({ ...direct, hasPicture: false })).toBe(true)
  })
  it('the phone, which has no live route here, says so at once', () => {
    expect(filmErrorShows({ ...direct, phone: true, probed: false })).toBe(true)
  })
  it('no error, nothing to say', () => {
    expect(filmErrorShows({ ...direct, hasError: false, tried: true })).toBe(false)
  })
})

describe('a film meant to start by itself (#491)', () => {
  it('has started as soon as it is not paused', () => {
    expect(autostartCheck({ paused: false, held: false, elapsedMs: 0 })).toBe('started')
  })
  it('waits while it is still in flight, even a long rescue', () => {
    expect(autostartCheck({ paused: true, held: false, elapsedMs: AUTOSTART_MS - 1 })).toBe('wait')
  })
  it('has failed only when the bounded wait runs out', () => {
    expect(autostartCheck({ paused: true, held: false, elapsedMs: AUTOSTART_MS })).toBe('failed')
  })
  it('is no failure when you paused it yourself', () => {
    expect(autostartCheck({ paused: true, held: true, elapsedMs: AUTOSTART_MS * 2 })).toBe('held')
  })
})
