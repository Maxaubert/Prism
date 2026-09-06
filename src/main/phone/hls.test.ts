import { describe, expect, it } from 'vitest'
import { fwd, hlsArgs, jobId, looksLikeGpuFailure, nextAction, playlistText, segmentCount, segmentFile } from './hls'

const plan = { mode: 'hls' as const, copyVideo: false, copyAudio: false, tonemap: false, height: 1080, audioOnly: false }

describe('playlist', () => {
  it('lists every segment up front, VOD, ending', () => {
    expect(segmentCount(10)).toBe(3)
    expect(segmentCount(8)).toBe(2)
    expect(segmentCount(0)).toBe(1)
    const t = playlistText(10)
    expect(t).toContain('#EXT-X-PLAYLIST-TYPE:VOD')
    expect(t).toContain('#EXT-X-MAP:URI="init.mp4"')
    expect(t).toContain('#EXTINF:4.000000,\n0.m4s')
    expect(t).toContain('#EXTINF:2.000000,\n2.m4s')
    expect(t.trim().endsWith('#EXT-X-ENDLIST')).toBe(true)
  })
  it('carries the query it is given on every uri, so the token rides with the segments', () => {
    const t = playlistText(10, '?t=abc')
    expect(t).toContain('#EXT-X-MAP:URI="init.mp4?t=abc"')
    expect(t).toContain('#EXTINF:4.000000,\n0.m4s?t=abc')
    expect(t).toContain('#EXTINF:2.000000,\n2.m4s?t=abc')
    expect(playlistText(10)).not.toContain('?')
  })
  it('a film that ends on a boundary has no zero-length tail', () => {
    const t = playlistText(8)
    expect(t).toContain('#EXTINF:4.000000,\n1.m4s')
    expect(t).not.toContain('2.m4s')
  })
  it('job ids are stable per phone and file', () => {
    expect(jobId('t', 'C:\\a.mkv')).toBe(jobId('t', 'c:\\A.MKV'))
    expect(jobId('t', 'C:\\a.mkv')).not.toBe(jobId('u', 'C:\\a.mkv'))
    expect(jobId('t', 'C:\\a.mkv')).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('hlsArgs', () => {
  const base = { ffmpeg: 'f', file: 'C:\\f\\a.mkv', outDir: 'C:\\u\\phone\\hls\\j', audioIndex: 1 }
  it('seeks before the input, keeps absolute timestamps, forces keyframes at the boundary from the start time', () => {
    const a = hlsArgs({ ...base, plan, startSegment: 3, encoder: { video: 'nvenc' } })
    expect(a.indexOf('-ss')).toBeLessThan(a.indexOf('-i'))
    expect(a[a.indexOf('-ss') + 1]).toBe('12.000000')
    expect(a).toContain('-copyts')
    expect(a[a.indexOf('-force_key_frames') + 1]).toBe('expr:gte(t,12+n_forced*4)')
    expect(a[a.indexOf('-start_number') + 1]).toBe('3')
    expect(a).toContain('h264_nvenc')
    expect(a).toContain('-hwaccel')
  })
  it('starts at the beginning with no seek at all', () => {
    const a = hlsArgs({ ...base, plan, startSegment: 0, encoder: { video: 'nvenc' } })
    expect(a).not.toContain('-ss')
    expect(a[a.indexOf('-force_key_frames') + 1]).toBe('expr:gte(t,0+n_forced*4)')
  })
  it('hands ffmpeg forward slashes, never backslashes', () => {
    const a = hlsArgs({ ...base, plan, startSegment: 0, encoder: { video: 'nvenc' } })
    expect(a[a.length - 1]).toBe('C:/u/phone/hls/j/ffmpeg.m3u8')
    expect(a[a.indexOf('-hls_segment_filename') + 1]).toBe('C:/u/phone/hls/j/%d.m4s')
    expect(fwd('C:\\x\\y')).toBe('C:/x/y')
  })
  it('copies what it can, scales an encode, tone-maps HDR through libplacebo', () => {
    const copy = hlsArgs({ ...base, plan: { ...plan, copyVideo: true, copyAudio: true, height: null }, startSegment: 0, encoder: { video: 'nvenc' } })
    expect(copy).toContain('-c:v')
    expect(copy[copy.indexOf('-c:v') + 1]).toBe('copy')
    expect(copy[copy.indexOf('-c:a') + 1]).toBe('copy')
    expect(copy).not.toContain('-force_key_frames')
    expect(copy).not.toContain('-hwaccel')
    const hdr = hlsArgs({ ...base, plan: { ...plan, tonemap: true }, startSegment: 0, encoder: { video: 'nvenc' } })
    const vf = hdr[hdr.indexOf('-vf') + 1]
    expect(vf).toContain('libplacebo=')
    expect(vf).toContain('h=1080')
    expect(hdr).toContain('vulkan=vk')
    const sdr = hlsArgs({ ...base, plan, startSegment: 0, encoder: { video: 'nvenc' } })
    expect(sdr[sdr.indexOf('-vf') + 1]).toBe('scale_cuda=-2:1080:format=nv12')
    const same = hlsArgs({ ...base, plan: { ...plan, height: null }, startSegment: 0, encoder: { video: 'nvenc' } })
    expect(same[same.indexOf('-vf') + 1]).toBe('scale_cuda=iw:ih:format=nv12')
  })
  it('the software fallback uses openh264 and zscale tone-mapping', () => {
    const a = hlsArgs({ ...base, plan: { ...plan, tonemap: true }, startSegment: 0, encoder: { video: 'openh264' } })
    expect(a).toContain('libopenh264')
    expect(a).not.toContain('-hwaccel')
    expect(a).not.toContain('vulkan=vk')
    expect(a[a.indexOf('-vf') + 1]).toContain('tonemap=hable')
    expect(a[a.indexOf('-vf') + 1]).toContain('scale=-2:1080')
    const sdr = hlsArgs({ ...base, plan, startSegment: 0, encoder: { video: 'openh264' } })
    expect(sdr[sdr.indexOf('-vf') + 1]).toBe('scale=-2:1080,format=yuv420p')
  })
  it('audio only drops the picture', () => {
    const a = hlsArgs({ ...base, plan: { ...plan, audioOnly: true, height: null }, startSegment: 0, encoder: { video: 'nvenc' } })
    expect(a).toContain('-vn')
    expect(a).not.toContain('-c:v')
    expect(a).not.toContain('-hwaccel')
    expect(a[a.indexOf('-c:a') + 1]).toBe('aac')
  })
  it('a file with no audio maps none', () => {
    const a = hlsArgs({ ...base, audioIndex: null, plan, startSegment: 0, encoder: { video: 'nvenc' } })
    expect(a).toContain('-an')
    expect(a).not.toContain('-c:a')
  })
  it('maps the chosen audio stream by its index', () => {
    const a = hlsArgs({ ...base, audioIndex: 2, plan, startSegment: 0, encoder: { video: 'nvenc' } })
    expect(a[a.indexOf('0:2') - 1]).toBe('-map')
  })
})

describe('nextAction', () => {
  it('serves what exists, waits for what is next, restarts for a far seek', () => {
    expect(nextAction({ startSegment: 0, produced: 5, wanted: 3, total: 100 })).toBe('serve')
    expect(nextAction({ startSegment: 0, produced: 5, wanted: 6, total: 100 })).toBe('wait')
    expect(nextAction({ startSegment: 0, produced: 5, wanted: 8, total: 100 })).toBe('wait')
    expect(nextAction({ startSegment: 0, produced: 5, wanted: 9, total: 100 })).toBe('restart')
    expect(nextAction({ startSegment: 10, produced: 12, wanted: 2, total: 100 })).toBe('restart')
    expect(nextAction({ startSegment: 10, produced: -1, wanted: 10, total: 100 })).toBe('wait')
  })
  it('segment files are numbered plainly', () => {
    expect(segmentFile('C:\\d', 7)).toBe('C:\\d\\7.m4s')
  })
})

describe('looksLikeGpuFailure', () => {
  it('recognises NVENC and CUDA refusals', () => {
    expect(looksLikeGpuFailure('Cannot load nvcuda.dll')).toBe(true)
    expect(looksLikeGpuFailure('[h264_nvenc @ 0] OpenEncodeSessionEx failed: out of memory (10)')).toBe(true)
    expect(looksLikeGpuFailure('No such file or directory')).toBe(false)
  })
})
