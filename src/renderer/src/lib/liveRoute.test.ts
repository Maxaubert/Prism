import { describe, expect, it } from 'vitest'
import { hevcMime, pictureRoute, rescueLive } from './liveRoute'

/** A PC that answers `canPlayType` with `yes` for exactly these mimes. */
const pc =
  (...yes: string[]) =>
  (mime: string): string =>
    yes.includes(mime) ? 'probably' : ''
const MAIN = 'video/mp4; codecs="hvc1.1.6.L120.90"'
const MAIN10 = 'video/mp4; codecs="hvc1.2.4.L120.90"'

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
