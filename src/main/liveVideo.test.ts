import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MediaInfo } from './ffmpeg'
import { createLiveVideo, isLiveRequest, livePlan, liveUrl, parseLiveUrl } from './liveVideo'
import { fakeFfmpeg } from './phone/testing/fakeFfmpeg'

const iphone = (o: Partial<NonNullable<MediaInfo['video']>> = {}, audio = 'aac'): MediaInfo => ({
  audio: audio ? { index: 1, title: '', codec: audio, channels: 2, layout: 'stereo', language: 'und', duration: 20 } : null,
  tracks: [],
  videoCodec: 'hevc',
  video: { width: 1920, height: 1080, pixFmt: 'yuv420p', transfer: 'bt709', profile: 'Main', rotation: -90, ...o },
  fps: 30,
  duration: 20
})

describe('livePlan: how the desktop transcodes a picture it cannot decode', () => {
  it('always encodes the picture, copies AAC, keeps the turn', () => {
    const { plan, audioIndex } = livePlan(iphone(), true)!
    expect(plan).toMatchObject({ mode: 'hls', copyVideo: false, copyAudio: true, tonemap: false, height: null, rotation: -90 })
    expect(audioIndex).toBe(1)
  })
  it('tone-maps HLG and HDR10 (the owner’s Main 10 films are HLG)', () => {
    expect(livePlan(iphone({ transfer: 'arib-std-b67', profile: 'Main 10' }), true)!.plan.tonemap).toBe(true)
    expect(livePlan(iphone({ transfer: 'smpte2084' }), false)!.plan.tonemap).toBe(true)
  })
  it('encodes an iPhone’s PCM to AAC, and leaves Dolby to the sidecar', () => {
    const pcm = livePlan(iphone({}, 'pcm_s16le'), true)!
    expect(pcm.plan.copyAudio).toBe(false)
    expect(pcm.audioIndex).toBe(1)
    expect(livePlan(iphone({}, 'ac3'), true)!.audioIndex).toBeNull()
    expect(livePlan(iphone({}, ''), true)!.audioIndex).toBeNull()
  })
  it('4K keeps its size on the GPU, the software encoder gets 1080 on the short side', () => {
    const uhd = iphone({ width: 3840, height: 2160 })
    expect(livePlan(uhd, true)!.plan.height).toBeNull()
    expect(livePlan(uhd, false)!.plan.height).toBe(1080)
    expect(livePlan(iphone(), false)!.plan.height).toBeNull()
  })
  it('nothing to transcode without a picture', () => {
    expect(livePlan(null, true)).toBeNull()
    expect(livePlan({ ...iphone(), videoCodec: null, video: null }, true)).toBeNull()
  })
})

describe('live urls', () => {
  it('round-trip, and nothing else parses', () => {
    const u = liveUrl('0123456789abcdef')
    expect(isLiveRequest(u)).toBe(true)
    expect(parseLiveUrl(u)).toEqual({ id: '0123456789abcdef', name: 'index.m3u8' })
    expect(parseLiveUrl('fsmedia://live/0123456789abcdef/12.m4s')).toEqual({ id: '0123456789abcdef', name: '12.m4s' })
    expect(parseLiveUrl('fsmedia://live/0123456789abcdef/../x')).toBeNull()
    expect(parseLiveUrl('fsmedia://local/C%3A%5Ca.mov')).toBeNull()
    expect(isLiveRequest('fsmedia://local/C%3A%5Clive%5Ca.mov')).toBe(false)
  })
})

describe('createLiveVideo', () => {
  let base: string
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'prism-live-'))
  })
  afterEach(() => rmSync(base, { recursive: true, force: true }))

  const film = 'C:\\films\\IMG_0001.MOV'
  const make = (readable: (p: string) => boolean = () => true) => {
    const fake = fakeFfmpeg()
    const held: string[] = []
    const live = createLiveVideo({
      ffmpeg: 'f',
      baseDir: base,
      readable,
      spawn: fake.spawn,
      hold: (_c, f) => held.push(f)
    })
    return { live, spawned: fake.spawned, held }
  }
  const get = (live: ReturnType<typeof make>['live'], url: string): Promise<Response> => live.serve(new Request(url))

  it('serves a playlist of the whole film, then init and segments made by ffmpeg', async () => {
    const { live, spawned, held } = make()
    const r = await live.open(1, film, iphone())
    if (!('url' in r)) throw new Error(r.error)
    expect(r.duration).toBe(20)
    const list = await get(live, r.url)
    expect(list.status).toBe(200)
    expect(list.headers.get('content-type')).toContain('mpegurl')
    expect(await list.text()).toContain('4.m4s')
    expect(spawned).toHaveLength(0) // nothing runs until a segment is asked for
    const init = await get(live, r.url.replace('index.m3u8', 'init.mp4'))
    expect(init.status).toBe(200)
    expect((await get(live, r.url.replace('index.m3u8', '0.m4s'))).status).toBe(200)
    expect(spawned).toHaveLength(1)
    expect(held).toEqual([film]) // a move of the film stops this ffmpeg first (#127)
    await live.stopAll()
  })

  it('the wall is asked at open and on every request', async () => {
    let open = true
    const { live } = make((p) => open && p === film)
    expect(await live.open(1, 'C:\\elsewhere\\x.mov', iphone())).toEqual({ error: 'outside the folder' })
    const r = await live.open(1, film, iphone())
    if (!('url' in r)) throw new Error(r.error)
    open = false
    expect((await get(live, r.url)).status).toBe(403)
    expect((await get(live, 'fsmedia://live/ffffffffffffffff/index.m3u8')).status).toBe(403)
    expect((await get(live, 'fsmedia://live/nonsense')).status).toBe(404)
    await live.stopAll()
  })

  it('stopping kills the ffmpeg; a second player of the same film keeps it until it lets go too', async () => {
    const { live, spawned } = make()
    const a = await live.open(1, film, iphone())
    const b = await live.open(1, film, iphone())
    if (!('url' in a) || !('url' in b)) throw new Error('no url')
    expect(b.url).toBe(a.url)
    await get(live, a.url.replace('index.m3u8', '0.m4s'))
    expect(live.running(1, film)).toBe(true)
    await live.stop(1, film)
    expect(live.running(1, film)).toBe(true)
    await live.stop(1, film)
    expect(live.running(1, film)).toBe(false)
    expect(spawned[0].killed || spawned.length === 1).toBe(true)
    expect((await get(live, a.url)).status).toBe(403) // the job is gone
  })

  it('a window that closes stops all of its own, and only its own', async () => {
    const { live } = make()
    const mine = await live.open(1, film, iphone())
    const theirs = await live.open(2, film, iphone())
    if (!('url' in mine) || !('url' in theirs)) throw new Error('no url')
    expect(mine.url).not.toBe(theirs.url)
    await live.stopPage(1)
    expect((await get(live, mine.url)).status).toBe(403)
    expect((await get(live, theirs.url)).status).toBe(200)
    await live.stopAll()
  })

  it('refuses a file with no picture or no length', async () => {
    const { live } = make()
    expect(await live.open(1, film, null)).toEqual({ error: 'nothing to play' })
    expect(await live.open(1, film, { ...iphone(), duration: 0 })).toEqual({ error: 'nothing to play' })
  })
})
