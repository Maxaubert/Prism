# Prism on your phone, PR 2: transcode to HLS for what the phone cannot play

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A film the phone cannot play as it is (an MKV, HEVC on an Android, Dolby audio anywhere) plays on the phone through a live GPU transcode to HLS that seeks like a file.

**Architecture:** `/api/play` decides direct or HLS per file and per DEVICE (the phone reports what it can play). HLS is a playlist Prism WRITES itself (every segment of the whole film, up front, so the scrubber shows the full duration) while one ffmpeg job per phone-and-file produces fMP4 segments in `userData/phone/hls/<job>/`; a request for a segment the job has not reached restarts ffmpeg at that segment's time, with absolute timestamps (`-copyts`) so the player lands where the playlist says. The phone plays the playlist natively (iPhone, iPad) or through `hls.js` (Android), attached to the reused `VideoView` through one new prop.

**Tech Stack:** bundled ffmpeg (h264_nvenc, cuda decode, libplacebo over Vulkan for HDR tone-mapping, libopenh264 fallback), Node `child_process.spawn`, `hls.js` (new renderer dependency, loaded on demand), Vitest, the Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-09-06-phone-design.md`

## Measured on this machine (2026-09-06, RTX 5090), which the plan is built on

| Pipeline | Source | Speed |
|---|---|---|
| cuda decode, `scale_cuda` to 1080p, `h264_nvenc` p4 | 4K SDR HEVC 10-bit (Zoolander) | 13.4x to 15x realtime |
| cuda decode, `libplacebo` (Vulkan) tone-map to 1080p bt709, `h264_nvenc` | 4K HDR10 HEVC remux (Hellboy II) | 7.5x realtime, colours right |
| cuda decode, `scale_cuda`, no tone-map | same HDR remux | 4.2x, and the picture is flat grey (compared frame by frame) |
| software `zscale`+`tonemap` (hable) | same HDR remux | 6x (the CPU fallback) |
| `tonemap_opencl` | same HDR remux | 0.7x: unusable |
| time to first segment after a 10-minute seek | Zoolander | 1.06s |

Two traps met on the way, both go in the code: `-hls_time 4` alone produced 10.4s segments (NVENC's GOP decides, so keyframes are FORCED at the segment boundary), and a playlist path with BACKSLASHES made ffmpeg write `init.mp4` into the current directory (its HLS muxer finds the directory by the last `/`), so every output path is handed over with forward slashes.

## Global Constraints

- No em-dashes anywhere.
- Branch `feat/105-phone-transcode` off `feat/104-phone-server`; issue #105; version `0.39.0`.
- Nothing synchronous on main's thread: `spawn`, `fs/promises`, `fs.watch` or a 100ms poll for a segment file; never `execFileSync`.
- Every HLS job is walled: the file passed `validRoot` for the phone at `/api/play`; the job dir is under `userData` and only `<n>.m4s`, `init.mp4` and `index.m3u8` are served from it.
- Segment length `SEGMENT_SECONDS = 4`. Encode ceiling 1080p. Audio always AAC stereo 192k when encoded.
- Commit trailer: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01MGe29Jw7CVa2MjsshPeQPM`.

---

### Task 1: The probe learns the picture's shape

**Files:**
- Modify: `src/main/ffmpeg.ts` (`PROBE_ARGS`, `ProbeStream`, `MediaInfo`, `readProbe`)
- Test: `src/main/ffmpeg.test.ts`

**Interfaces:**
- Produces on `MediaInfo`:
  ```ts
  video: { width: number; height: number; pixFmt: string; transfer: string } | null
  ```
  `videoCodec` stays as it is (other callers read it).

- [ ] **Step 1: Failing test**

Add to the `readProbe` describe in `src/main/ffmpeg.test.ts`:

```ts
  it('reads the picture shape and transfer, for the phone transcode', () => {
    const r = readProbe(
      probe([
        { index: 0, codec_type: 'video', codec_name: 'hevc', width: 3840, height: 2160, pix_fmt: 'yuv420p10le', color_transfer: 'smpte2084' },
        { index: 1, codec_type: 'audio', codec_name: 'eac3', channels: 8 }
      ])
    )
    expect(r?.video).toEqual({ width: 3840, height: 2160, pixFmt: 'yuv420p10le', transfer: 'smpte2084' })
    const none = readProbe(probe([{ index: 1, codec_type: 'audio', codec_name: 'aac' }]))
    expect(none?.video).toBeNull()
  })
```

Run: `npx vitest run src/main/ffmpeg.test.ts` and expect the new test to FAIL (`video` undefined).

- [ ] **Step 2: Implement**

In `PROBE_ARGS` extend the stream entries: `stream=index,codec_type,codec_name,channels,channel_layout,disposition,avg_frame_rate,r_frame_rate,width,height,pix_fmt,color_transfer`. Add `width?: number; height?: number; pix_fmt?: string; color_transfer?: string` to `ProbeStream`, the `video` field to `MediaInfo` (with a comment: the phone transcode needs the height for its 1080p ceiling and the transfer to know HDR from SDR, 2026-09-06 #105), and in `readProbe`:

```ts
    video:
      video && typeof video.width === 'number' && typeof video.height === 'number'
        ? { width: video.width, height: video.height, pixFmt: video.pix_fmt ?? '', transfer: video.color_transfer ?? '' }
        : null,
```

Run the ffmpeg tests and `npm run typecheck` (every place that builds a `MediaInfo` literal, tests included, needs `video: null`; grep `videoCodec:` to find them).

- [ ] **Step 3: Commit**

```bash
git add src/main/ffmpeg.ts src/main/ffmpeg.test.ts
git commit -m "feat(phone): ffprobe reports the picture's size and transfer (#105)"
```

---

### Task 2: The decision, pure

**Files:**
- Create: `src/main/phone/decide.ts`, `src/main/phone/decide.test.ts`

**Interfaces:**
- Produces:
  ```ts
  /** What the phone said it plays: codec and container tokens. */
  export type Can = ReadonlySet<string>   // e.g. 'h264','hevc','vp9','av1','aac','mp3','flac','opus','ac3','eac3','mp4','webm','hls-native'
  export type PlayPlan =
    | { mode: 'direct' }
    | { mode: 'hls'; copyVideo: boolean; copyAudio: boolean; tonemap: boolean; height: number | null; audioOnly: boolean }
    | { mode: 'none'; reason: string }
  export const ENCODE_MAX_HEIGHT = 1080
  export function parseCan(csv: string | null | undefined): Can
  export function decide(info: MediaInfo | null, ext: string, can: Can): PlayPlan
  export function isHdr(transfer: string): boolean
  ```

- [ ] **Step 1: Failing tests**

```ts
// src/main/phone/decide.test.ts
import { describe, expect, it } from 'vitest'
import type { MediaInfo } from '../ffmpeg'
import { decide, isHdr, parseCan } from './decide'

const info = (o: Partial<MediaInfo> & { videoCodec?: string | null; audioCodec?: string | null; height?: number; transfer?: string }): MediaInfo => ({
  audio: o.audioCodec === null ? null : { index: 1, title: '', codec: o.audioCodec ?? 'aac', channels: 2, layout: 'stereo', language: '', duration: 100 },
  tracks: [],
  videoCodec: o.videoCodec === undefined ? 'h264' : o.videoCodec,
  fps: 24,
  duration: 100,
  video: o.videoCodec === null ? null : { width: 1920, height: o.height ?? 1080, pixFmt: 'yuv420p', transfer: o.transfer ?? 'bt709' }
})

const iphone = parseCan('h264,hevc,aac,mp3,flac,ac3,eac3,mp4,webm,hls-native')
const android = parseCan('h264,vp9,av1,aac,mp3,flac,opus,mp4,webm')

describe('decide', () => {
  it('plays an mp4 of h264 + aac directly on anything', () => {
    expect(decide(info({}), '.mp4', iphone)).toEqual({ mode: 'direct' })
    expect(decide(info({}), '.mp4', android)).toEqual({ mode: 'direct' })
  })
  it('an mkv is never direct: the container decides before the codecs', () => {
    expect(decide(info({}), '.mkv', iphone)).toMatchObject({ mode: 'hls', copyVideo: true, copyAudio: true })
  })
  it('copies what the phone plays and encodes what it does not', () => {
    expect(decide(info({ videoCodec: 'hevc', audioCodec: 'ac3' }), '.mkv', iphone)).toMatchObject({ mode: 'hls', copyVideo: true, copyAudio: true })
    expect(decide(info({ videoCodec: 'hevc', audioCodec: 'ac3' }), '.mkv', android)).toMatchObject({ mode: 'hls', copyVideo: false, copyAudio: false })
    expect(decide(info({ videoCodec: 'mpeg4' }), '.avi', iphone)).toMatchObject({ mode: 'hls', copyVideo: false, copyAudio: true })
  })
  it('caps an encode at 1080p and leaves a copy at its own size', () => {
    expect(decide(info({ videoCodec: 'hevc', height: 2160 }), '.mkv', android)).toMatchObject({ copyVideo: false, height: 1080 })
    expect(decide(info({ videoCodec: 'hevc', height: 2160 }), '.mkv', iphone)).toMatchObject({ copyVideo: true, height: null })
    expect(decide(info({ videoCodec: 'mpeg4', height: 720 }), '.avi', android)).toMatchObject({ copyVideo: false, height: null })
  })
  it('tone-maps HDR only when it encodes', () => {
    expect(isHdr('smpte2084')).toBe(true)
    expect(isHdr('arib-std-b67')).toBe(true)
    expect(isHdr('bt709')).toBe(false)
    expect(decide(info({ videoCodec: 'hevc', transfer: 'smpte2084' }), '.mkv', android)).toMatchObject({ copyVideo: false, tonemap: true })
    expect(decide(info({ videoCodec: 'hevc', transfer: 'smpte2084' }), '.mkv', iphone)).toMatchObject({ copyVideo: true, tonemap: false })
  })
  it('audio-only files: direct when the container and codec play, else an audio HLS', () => {
    expect(decide(info({ videoCodec: null, audioCodec: 'mp3' }), '.mp3', android)).toEqual({ mode: 'direct' })
    expect(decide(info({ videoCodec: null, audioCodec: 'flac' }), '.flac', iphone)).toEqual({ mode: 'direct' })
    expect(decide(info({ videoCodec: null, audioCodec: 'wmav2' }), '.wma', iphone)).toMatchObject({ mode: 'hls', audioOnly: true, copyAudio: false })
    expect(decide(info({ videoCodec: null, audioCodec: 'opus' }), '.ogg', iphone)).toMatchObject({ mode: 'hls', audioOnly: true })
  })
  it('gives up honestly with no probe', () => {
    expect(decide(null, '.mkv', iphone)).toEqual({ mode: 'none', reason: 'Prism could not read this file' })
  })
  it('parses the can list defensively', () => {
    expect([...parseCan(' H264, aac ,,x')]).toEqual(['h264', 'aac', 'x'])
    expect(parseCan(null).size).toBe(0)
  })
})
```

- [ ] **Step 2: Run, expect FAIL** (`npx vitest run src/main/phone/decide.test.ts`).

- [ ] **Step 3: Implement**

```ts
// src/main/phone/decide.ts
/**
 * Direct or HLS, per file and per DEVICE (2026-09-06, #105). The phone says
 * what it plays (canPlayType, reported as tokens) and the decision is a
 * plain lookup: a container the phone cannot demux is HLS whatever the
 * codecs; a codec the phone plays is COPIED into the segments and a codec
 * it does not is encoded. Nothing is assumed from a user agent.
 */
import type { MediaInfo } from '../ffmpeg'

export type Can = ReadonlySet<string>

export type PlayPlan =
  | { mode: 'direct' }
  | { mode: 'hls'; copyVideo: boolean; copyAudio: boolean; tonemap: boolean; height: number | null; audioOnly: boolean }
  | { mode: 'none'; reason: string }

export const ENCODE_MAX_HEIGHT = 1080

/** Containers a phone's <video>/<audio> can open by itself. */
const DIRECT_CONTAINERS: Record<string, string> = {
  '.mp4': 'mp4', '.m4v': 'mp4', '.mov': 'mp4', '.m4a': 'mp4', '.aac': 'mp4',
  '.webm': 'webm', '.mp3': 'mp3', '.flac': 'flac', '.wav': 'wav', '.ogg': 'ogg', '.oga': 'ogg', '.opus': 'ogg'
}
/** Codecs whose container token is enough: an mp3 file IS its codec. */
const SELF_CONTAINED = new Set(['mp3', 'flac', 'wav'])

export function parseCan(csv: string | null | undefined): Can {
  return new Set((csv ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))
}

export function isHdr(transfer: string): boolean {
  return transfer === 'smpte2084' || transfer === 'arib-std-b67'
}

export function decide(info: MediaInfo | null, ext: string, can: Can): PlayPlan {
  if (!info) return { mode: 'none', reason: 'Prism could not read this file' }
  const container = DIRECT_CONTAINERS[ext.toLowerCase()]
  const vcodec = info.videoCodec?.toLowerCase() ?? null
  const acodec = info.audio?.codec.toLowerCase() ?? null
  const videoOk = !vcodec || can.has(vcodec)
  const audioOk =
    !acodec || can.has(acodec) || (container && SELF_CONTAINED.has(container) && can.has(container)) || acodec === 'pcm_s16le'
  const containerOk = !!container && (can.has(container) || SELF_CONTAINED.has(container) ? can.has(container) : false)
  if (containerOk && videoOk && audioOk) return { mode: 'direct' }
  const audioOnly = !vcodec
  const copyVideo = !audioOnly && can.has(vcodec!)
  const hdr = !!info.video && isHdr(info.video.transfer)
  const height = !audioOnly && !copyVideo && info.video && info.video.height > ENCODE_MAX_HEIGHT ? ENCODE_MAX_HEIGHT : null
  return {
    mode: 'hls',
    audioOnly,
    copyVideo,
    // AAC is the one codec every HLS player takes; anything else is re-encoded
    // even when the phone could play it in a file, because HLS is stricter.
    copyAudio: acodec === 'aac' || (!!acodec && can.has(acodec) && (acodec === 'ac3' || acodec === 'eac3')),
    tonemap: hdr && !copyVideo && !audioOnly,
    height
  }
}
```

Adjust the `containerOk` expression until the tests pass without special-casing beyond the two tables; `audioOk` for `.mp3`/`.flac`/`.wav` relies on the phone reporting the container token (Task 6 reports `mp3`, `flac`, `wav` from `canPlayType('audio/mpeg')` etc.).

- [ ] **Step 4: Run, expect PASS. Commit**

```bash
git add src/main/phone/decide.ts src/main/phone/decide.test.ts
git commit -m "feat(phone): direct-or-HLS decision per file and per device, pure and tested (#105)"
```

---

### Task 3: Playlist, ffmpeg argv and the job rules, pure

**Files:**
- Create: `src/main/phone/hls.ts`, `src/main/phone/hls.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const SEGMENT_SECONDS = 4
  export function segmentCount(duration: number): number
  export function playlistText(duration: number): string
  export function jobId(token: string, file: string): string            // 16 hex chars
  export interface Encoder { video: 'nvenc' | 'openh264' }
  export function hlsArgs(o: { ffmpeg: string; file: string; plan: PlayPlan & { mode: 'hls' }; startSegment: number; outDir: string; encoder: Encoder; audioIndex: number | null }): string[]
  export function segmentFile(outDir: string, n: number): string
  export type JobAction = 'serve' | 'wait' | 'restart'
  export function nextAction(o: { startSegment: number; produced: number; wanted: number; total: number }): JobAction   // produced = highest COMPLETE segment index, -1 if none
  export function looksLikeGpuFailure(stderr: string): boolean
  export function fwd(p: string): string                                   // forward slashes
  ```

- [ ] **Step 1: Failing tests**

```ts
// src/main/phone/hls.test.ts
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
    const hdr = hlsArgs({ ...base, plan: { ...plan, tonemap: true }, startSegment: 0, encoder: { video: 'nvenc' } })
    const vf = hdr[hdr.indexOf('-vf') + 1]
    expect(vf).toContain('libplacebo=')
    expect(vf).toContain('h=1080')
    expect(hdr).toContain('vulkan=vk')
    const sdr = hlsArgs({ ...base, plan, startSegment: 0, encoder: { video: 'nvenc' } })
    expect(sdr[sdr.indexOf('-vf') + 1]).toBe('scale_cuda=-2:1080:format=nv12')
  })
  it('the software fallback uses openh264 and zscale tone-mapping', () => {
    const a = hlsArgs({ ...base, plan: { ...plan, tonemap: true }, startSegment: 0, encoder: { video: 'openh264' } })
    expect(a).toContain('libopenh264')
    expect(a).not.toContain('-hwaccel')
    expect(a[a.indexOf('-vf') + 1]).toContain('tonemap=hable')
  })
  it('audio only drops the picture', () => {
    const a = hlsArgs({ ...base, plan: { ...plan, audioOnly: true, height: null }, startSegment: 0, encoder: { video: 'nvenc' } })
    expect(a).toContain('-vn')
    expect(a).not.toContain('-c:v')
  })
  it('a file with no audio maps none', () => {
    const a = hlsArgs({ ...base, audioIndex: null, plan, startSegment: 0, encoder: { video: 'nvenc' } })
    expect(a).toContain('-an')
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
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement**

```ts
// src/main/phone/hls.ts
/**
 * HLS the way a live transcode can seek (2026-09-06, #105). Prism writes the
 * PLAYLIST itself: every segment of the whole film, four seconds each, VOD,
 * so the scrubber knows the duration from the first byte and can ask for
 * segment 400 before segment 2 exists. ffmpeg only makes segment FILES, from
 * whatever segment it was started at, with `-copyts` so a segment's own
 * timestamps say where in the film it is - without that a job restarted at
 * minute 30 would produce a segment claiming to be minute 0. Keyframes are
 * FORCED on the boundary (measured: `-hls_time 4` alone gave 10.4s segments,
 * NVENC's GOP deciding) and the expression carries the start time, or every
 * frame after a restart becomes a keyframe until n_forced catches up.
 * Paths go to ffmpeg with FORWARD slashes: its HLS muxer finds the output
 * directory by the last '/', and with backslashes wrote init.mp4 into the
 * current directory (measured).
 */
import { createHash } from 'crypto'
import { join } from 'path'
import type { PlayPlan } from './decide'

export const SEGMENT_SECONDS = 4
/** How far ahead of the produced head a request may be and still wait. */
const WAIT_AHEAD = 3

export function fwd(p: string): string {
  return p.replace(/\\/g, '/')
}

export function segmentCount(duration: number): number {
  return Math.max(1, Math.ceil(duration / SEGMENT_SECONDS))
}

export function playlistText(duration: number): string {
  const n = segmentCount(duration)
  const lines = ['#EXTM3U', '#EXT-X-VERSION:7', `#EXT-X-TARGETDURATION:${SEGMENT_SECONDS}`, '#EXT-X-MEDIA-SEQUENCE:0', '#EXT-X-PLAYLIST-TYPE:VOD', '#EXT-X-INDEPENDENT-SEGMENTS', '#EXT-X-MAP:URI="init.mp4"']
  for (let i = 0; i < n; i++) {
    const len = i === n - 1 ? Math.max(0.1, duration - i * SEGMENT_SECONDS) : SEGMENT_SECONDS
    lines.push(`#EXTINF:${len.toFixed(6)},`, `${i}.m4s`)
  }
  lines.push('#EXT-X-ENDLIST')
  return lines.join('\n') + '\n'
}

export function jobId(token: string, file: string): string {
  return createHash('sha256').update(`${token}|${file.toLowerCase()}`).digest('hex').slice(0, 16)
}

export function segmentFile(outDir: string, n: number): string {
  return join(outDir, `${n}.m4s`)
}

export interface Encoder {
  video: 'nvenc' | 'openh264'
}

const TONEMAP_GPU = (h: number | null): string =>
  `format=p010,hwupload,libplacebo=${h ? `w=-2:h=${h}:` : ''}tonemapping=bt.2390:colorspace=bt709:color_primaries=bt709:color_trc=bt709:format=yuv420p,hwdownload,format=yuv420p`
const TONEMAP_CPU = (h: number | null): string =>
  `${h ? `scale=-2:${h},` : ''}zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p`

export function hlsArgs(o: {
  ffmpeg: string
  file: string
  plan: PlayPlan & { mode: 'hls' }
  startSegment: number
  outDir: string
  encoder: Encoder
  audioIndex: number | null
}): string[] {
  const { plan } = o
  const start = o.startSegment * SEGMENT_SECONDS
  const gpu = o.encoder.video === 'nvenc'
  const encodeVideo = !plan.audioOnly && !plan.copyVideo
  const pre: string[] = []
  if (encodeVideo && gpu) {
    if (plan.tonemap) pre.push('-init_hw_device', 'vulkan=vk', '-filter_hw_device', 'vk', '-hwaccel', 'cuda')
    else pre.push('-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda')
  }
  const video: string[] = plan.audioOnly
    ? ['-vn']
    : plan.copyVideo
      ? ['-map', '0:v:0', '-c:v', 'copy']
      : [
          '-map', '0:v:0',
          '-vf',
          plan.tonemap
            ? gpu ? TONEMAP_GPU(plan.height) : TONEMAP_CPU(plan.height)
            : gpu ? `scale_cuda=${plan.height ? `-2:${plan.height}` : 'iw:ih'}:format=nv12` : `${plan.height ? `scale=-2:${plan.height},` : ''}format=yuv420p`,
          ...(gpu
            ? ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '23', '-b:v', '0', '-maxrate', '12M', '-bufsize', '24M', '-profile:v', 'high']
            : ['-c:v', 'libopenh264', '-b:v', '6000k', '-profile:v', 'high']),
          '-force_key_frames', `expr:gte(t,${start}+n_forced*${SEGMENT_SECONDS})`
        ]
  const audio: string[] =
    o.audioIndex === null ? ['-an'] : ['-map', `0:${o.audioIndex}`, ...(plan.copyAudio ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-ac', '2', '-b:a', '192k'])]
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    ...pre,
    ...(start > 0 ? ['-ss', start.toFixed(6)] : []),
    '-i', o.file,
    ...video,
    ...audio,
    '-sn', '-dn',
    '-copyts',
    '-f', 'hls',
    '-hls_time', String(SEGMENT_SECONDS),
    '-hls_segment_type', 'fmp4',
    '-hls_playlist_type', 'vod',
    '-hls_flags', 'temp_file+independent_segments',
    '-start_number', String(o.startSegment),
    '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_segment_filename', `${fwd(o.outDir)}/%d.m4s`,
    `${fwd(o.outDir)}/ffmpeg.m3u8`
  ]
}

export type JobAction = 'serve' | 'wait' | 'restart'

/** `produced` is the highest COMPLETE segment index the job has written, -1 for none yet. */
export function nextAction(o: { startSegment: number; produced: number; wanted: number; total: number }): JobAction {
  if (o.wanted < o.startSegment) return 'restart'
  if (o.wanted <= o.produced) return 'serve'
  const head = Math.max(o.produced, o.startSegment - 1)
  return o.wanted - head <= WAIT_AHEAD ? 'wait' : 'restart'
}

export function looksLikeGpuFailure(stderr: string): boolean {
  return /nvcuda|nvenc|cuda|OpenEncodeSession|No NVENC capable|hwaccel|vulkan|libplacebo/i.test(stderr)
}
```

Tune the scale expression for `scale_cuda` with no height (`iw:ih`) against the test; `-hls_flags temp_file` means a segment file only appears under its final name when it is COMPLETE, which is what the job code leans on.

- [ ] **Step 4: Run, expect PASS. Commit**

```bash
git add src/main/phone/hls.ts src/main/phone/hls.test.ts
git commit -m "feat(phone): the HLS playlist, ffmpeg argv and job rules, pure and tested (#105)"
```

---

### Task 4: Jobs: one ffmpeg per phone and file, restarted on a far seek

**Files:**
- Create: `src/main/phone/jobs.ts`, `src/main/phone/jobs.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface JobDeps {
    ffmpeg: string
    baseDir: string                          // userData/phone/hls
    spawn?: typeof import('child_process').spawn   // injectable for tests
    now?: () => number
  }
  export interface StartArgs { token: string; file: string; plan: PlayPlan & { mode: 'hls' }; duration: number; audioIndex: number | null }
  export class HlsJobs {
    constructor(deps: JobDeps)
    /** Registers (or refreshes) the job for this phone+file; returns its id and playlist text. */
    open(a: StartArgs): { id: string; playlist: string }
    /** Resolves the path of a COMPLETE segment file, starting or restarting ffmpeg as needed; null on failure or timeout (30s). */
    segment(id: string, n: number): Promise<string | null>
    /** init.mp4 for the job, once ffmpeg has written it. */
    init(id: string): Promise<string | null>
    lastError(id: string): string | null
    /** Kill jobs nobody asked about for 30s; called on a timer by the server. */
    reap(): void
    stopAll(): void
    /** The encoder in use; flips to openh264 after one GPU failure and stays. */
    encoder: Encoder
  }
  ```

- [ ] **Step 1: Failing test with a fake ffmpeg**

The fake `spawn` returns an EventEmitter with `stderr` (EventEmitter), `kill()`, and, on a short timer, writes `init.mp4` and segment files `start..start+k` into the out dir, one every 20ms, so the class's file-watching and restart logic is exercised without ffmpeg.

```ts
// src/main/phone/jobs.test.ts
import { EventEmitter } from 'events'
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HlsJobs } from './jobs'

let base: string
const spawned: Array<{ args: string[]; kill: () => void }> = []

function fakeSpawn(_cmd: string, args: string[]): never {
  const outDir = args[args.length - 1].replace(/\/ffmpeg\.m3u8$/, '')
  const start = Number(args[args.indexOf('-start_number') + 1])
  const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter; stdout: EventEmitter; kill: () => void; pid: number }
  child.stderr = new EventEmitter()
  child.stdout = new EventEmitter()
  child.pid = 1
  let n = start
  let alive = true
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'init.mp4'), 'init')
  const timer = setInterval(() => {
    if (!alive) return
    writeFileSync(join(outDir, `${n}.m4s`), `seg${n}`)
    n += 1
    if (n > start + 6) {
      clearInterval(timer)
      child.emit('exit', 0)
    }
  }, 20)
  child.kill = () => {
    alive = false
    clearInterval(timer)
    child.emit('exit', null)
  }
  spawned.push({ args, kill: child.kill })
  return child as never
}

const plan = { mode: 'hls' as const, copyVideo: false, copyAudio: false, tonemap: false, height: null, audioOnly: false }

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'prism-hls-'))
  spawned.length = 0
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

describe('HlsJobs', () => {
  it('starts ffmpeg on the first segment ask and serves as files complete', async () => {
    const jobs = new HlsJobs({ ffmpeg: 'f', baseDir: base, spawn: fakeSpawn as never })
    const { id, playlist } = jobs.open({ token: 't', file: 'C:\\a.mkv', plan, duration: 100, audioIndex: 1 })
    expect(playlist).toContain('24.m4s')
    const p0 = await jobs.segment(id, 0)
    expect(p0 && existsSync(p0)).toBe(true)
    expect(spawned).toHaveLength(1)
    const p2 = await jobs.segment(id, 2)
    expect(p2?.endsWith('2.m4s')).toBe(true)
    expect(spawned).toHaveLength(1) // waited, no restart
    expect(await jobs.init(id)).toContain('init.mp4')
    jobs.stopAll()
  })
  it('restarts at a far seek and serves from there', async () => {
    const jobs = new HlsJobs({ ffmpeg: 'f', baseDir: base, spawn: fakeSpawn as never })
    const { id } = jobs.open({ token: 't', file: 'C:\\a.mkv', plan, duration: 400, audioIndex: 1 })
    await jobs.segment(id, 0)
    const p = await jobs.segment(id, 50)
    expect(p?.endsWith('50.m4s')).toBe(true)
    expect(spawned).toHaveLength(2)
    expect(spawned[1].args[spawned[1].args.indexOf('-start_number') + 1]).toBe('50')
    jobs.stopAll()
  })
  it('refuses a segment outside the playlist and an unknown job', async () => {
    const jobs = new HlsJobs({ ffmpeg: 'f', baseDir: base, spawn: fakeSpawn as never })
    const { id } = jobs.open({ token: 't', file: 'C:\\a.mkv', plan, duration: 10, audioIndex: 1 })
    expect(await jobs.segment(id, 99)).toBeNull()
    expect(await jobs.segment('nope', 0)).toBeNull()
    jobs.stopAll()
  })
  it('reaps a job nobody asked about for 30 seconds', async () => {
    let t = 0
    const jobs = new HlsJobs({ ffmpeg: 'f', baseDir: base, spawn: fakeSpawn as never, now: () => t })
    const { id } = jobs.open({ token: 't', file: 'C:\\a.mkv', plan, duration: 100, audioIndex: 1 })
    await jobs.segment(id, 0)
    t = 31_000
    jobs.reap()
    expect(existsSync(join(base, id))).toBe(false)
    expect(await jobs.segment(id, 1)).toBeNull()
  })
})
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement**

```ts
// src/main/phone/jobs.ts
/**
 * One ffmpeg per phone and file (2026-09-06, #105). A job knows where it
 * started, what it has produced (the highest complete segment on disk, with
 * `temp_file` making "on disk" mean complete), and when it was last asked
 * about. A segment ask is one of three things (`nextAction`, pure): serve
 * it, wait for it (it is a few segments ahead of the head, at 7-15x
 * realtime that is under a second), or kill and restart at it. A job nobody
 * asks about for 30s is reaped, and its directory with it. The encoder
 * flips to software after ONE GPU refusal and stays there for the session:
 * a machine without NVENC would otherwise pay the refusal on every seek.
 */
import { spawn as nodeSpawn, type ChildProcess } from 'child_process'
import { existsSync, promises as fsp, rmSync } from 'fs'
import { join } from 'path'
import type { PlayPlan } from './decide'
import { hlsArgs, jobId, looksLikeGpuFailure, nextAction, playlistText, segmentCount, segmentFile, type Encoder } from './hls'

const IDLE_MS = 30_000
const WAIT_MS = 30_000
const POLL_MS = 100

export interface JobDeps {
  ffmpeg: string
  baseDir: string
  spawn?: typeof nodeSpawn
  now?: () => number
}

export interface StartArgs {
  token: string
  file: string
  plan: PlayPlan & { mode: 'hls' }
  duration: number
  audioIndex: number | null
}

interface Job extends StartArgs {
  id: string
  dir: string
  total: number
  proc: ChildProcess | null
  startSegment: number
  asked: number
  stderr: string
  failed: string | null
}

export class HlsJobs {
  private jobs = new Map<string, Job>()
  encoder: Encoder = { video: 'nvenc' }
  private readonly spawn: typeof nodeSpawn
  private readonly now: () => number

  constructor(private readonly deps: JobDeps) {
    this.spawn = deps.spawn ?? nodeSpawn
    this.now = deps.now ?? Date.now
  }

  open(a: StartArgs): { id: string; playlist: string } {
    const id = jobId(a.token, a.file)
    const existing = this.jobs.get(id)
    if (existing) {
      existing.asked = this.now()
      return { id, playlist: playlistText(existing.duration) }
    }
    const job: Job = { ...a, id, dir: join(this.deps.baseDir, id), total: segmentCount(a.duration), proc: null, startSegment: 0, asked: this.now(), stderr: '', failed: null }
    this.jobs.set(id, job)
    return { id, playlist: playlistText(a.duration) }
  }

  lastError(id: string): string | null {
    return this.jobs.get(id)?.failed ?? null
  }

  private produced(job: Job): number {
    // Highest complete segment on disk from the job's start; cheap, and it
    // only runs when a request arrives.
    let n = job.startSegment - 1
    while (existsSync(segmentFile(job.dir, n + 1))) n += 1
    return n
  }

  private start(job: Job, at: number): void {
    this.kill(job)
    job.startSegment = at
    job.failed = null
    job.stderr = ''
    rmSync(job.dir, { recursive: true, force: true })
    void fsp.mkdir(job.dir, { recursive: true }).then(() => {
      const args = hlsArgs({ ffmpeg: this.deps.ffmpeg, file: job.file, plan: job.plan, startSegment: at, outDir: job.dir, encoder: this.encoder, audioIndex: job.audioIndex })
      const proc = this.spawn(this.deps.ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
      job.proc = proc
      proc.stderr?.on('data', (c: Buffer) => {
        job.stderr = (job.stderr + c.toString()).slice(-4000)
      })
      proc.on('exit', (code) => {
        if (job.proc !== proc) return
        job.proc = null
        if (code !== 0 && code !== null) {
          const line = job.stderr.trim().split('\n').pop() ?? `ffmpeg exited ${code}`
          if (this.encoder.video === 'nvenc' && looksLikeGpuFailure(job.stderr)) {
            this.encoder = { video: 'openh264' }
            this.start(job, at) // once, on the software path
            return
          }
          job.failed = line
        }
      })
    })
  }

  private kill(job: Job): void {
    const p = job.proc
    job.proc = null
    if (p) p.kill()
  }

  async segment(id: string, n: number): Promise<string | null> {
    const job = this.jobs.get(id)
    if (!job || !Number.isInteger(n) || n < 0 || n >= job.total) return null
    job.asked = this.now()
    const deadline = this.now() + WAIT_MS
    let action = nextAction({ startSegment: job.startSegment, produced: this.produced(job), wanted: n, total: job.total })
    if (action === 'restart' || (!job.proc && action === 'wait' && this.produced(job) < n)) this.start(job, n)
    while (this.now() < deadline) {
      if (job.failed) return null
      const file = segmentFile(job.dir, n)
      if (existsSync(file)) return file
      // The job finished (exit 0) without the segment: the playlist was
      // longer than the film; treat as failure rather than wait 30s.
      if (!job.proc && job.startSegment <= n && this.produced(job) < n && action !== 'wait') return null
      await new Promise((r) => setTimeout(r, POLL_MS))
      action = 'wait'
    }
    return null
  }

  async init(id: string): Promise<string | null> {
    const job = this.jobs.get(id)
    if (!job) return null
    job.asked = this.now()
    if (!job.proc && this.produced(job) < job.startSegment) this.start(job, job.startSegment)
    const file = join(job.dir, 'init.mp4')
    const deadline = this.now() + WAIT_MS
    while (this.now() < deadline) {
      if (job.failed) return null
      if (existsSync(file)) return file
      await new Promise((r) => setTimeout(r, POLL_MS))
    }
    return null
  }

  reap(): void {
    const cutoff = this.now() - IDLE_MS
    for (const [id, job] of this.jobs) {
      if (job.asked < cutoff) {
        this.kill(job)
        rmSync(job.dir, { recursive: true, force: true })
        this.jobs.delete(id)
      }
    }
  }

  stopAll(): void {
    for (const job of this.jobs.values()) {
      this.kill(job)
      rmSync(job.dir, { recursive: true, force: true })
    }
    this.jobs.clear()
  }
}
```

The `segment()` loop's "finished without the segment" branch is the subtle one; make the fake ffmpeg in the test emit `exit 0` after its last file and add a test that asks for a segment past what a finished job produced (with `total` large) and expects a RESTART rather than null (a finished job that stopped short of the end is a job to restart, not a failure). Adjust: when `!job.proc` and the wanted segment is beyond `produced`, `start(job, n)`. Write that test, make it pass.

- [ ] **Step 4: Run, expect PASS; typecheck. Commit**

```bash
git add src/main/phone/jobs.ts src/main/phone/jobs.test.ts
git commit -m "feat(phone): HLS jobs: one ffmpeg per phone and file, restarted on a far seek, reaped when idle (#105)"
```

---

### Task 5: The routes: `/api/play` and `/hls/...`

**Files:**
- Modify: `src/main/phone/routes.ts` (+ test), `src/main/phone/server.ts` (+ test), `src/main/index.ts` (deps), `src/main/phone/store.ts` untouched

**Interfaces:**
- `parseRoute` gains `{ kind: 'hls'; job: string; file: string; query: URLSearchParams }` for `/hls/<job>/<file>` where file is `index.m3u8`, `init.mp4` or `<n>.m4s`; anything else is `none`.
- `PhoneDeps` gains:
  ```ts
  probe: (file: string) => Promise<MediaInfo | null>     // main's cached probe
  jobs: HlsJobs | null                                  // null when no ffmpeg
  ```
- `/api/play?path=&can=` answers `{ mode: 'direct', url } | { mode: 'hls', url, copyVideo, fps, duration } | { mode: 'none', reason }` where `url` is `/m/<enc>?t=` or `/hls/<job>/index.m3u8?t=`.

- [ ] **Step 1: Route test**

```ts
  it('names the hls routes and refuses anything else under them', () => {
    expect(parseRoute('/hls/abc/index.m3u8?t=x')).toMatchObject({ kind: 'hls', job: 'abc', file: 'index.m3u8' })
    expect(parseRoute('/hls/abc/12.m4s')).toMatchObject({ kind: 'hls', job: 'abc', file: '12.m4s' })
    expect(parseRoute('/hls/abc/init.mp4')).toMatchObject({ kind: 'hls', job: 'abc', file: 'init.mp4' })
    expect(parseRoute('/hls/abc/../x')).toEqual({ kind: 'none' })
    expect(parseRoute('/hls/abc/ffmpeg.m3u8')).toEqual({ kind: 'none' })
  })
```

Implement in `parseRoute`: `const m = /^\/hls\/([0-9a-f]{16})\/(index\.m3u8|init\.mp4|\d+\.m4s)$/.exec(p)`.

- [ ] **Step 2: Server tests**

In `server.test.ts`, extend the deps with a fake `probe` (returns an `MediaInfo` for `clip.mkv`: h264 + ac3, duration 10, video 1920x1080 bt709) and a real `HlsJobs` built on the fake `spawn` from `jobs.test.ts` (move that fake into `src/main/phone/testing/fakeFfmpeg.ts`, exported, so both tests share it). Then:

```ts
  it('/api/play answers direct for an mp4 the phone plays and hls for an mkv', async () => {
    const token = await pair()
    const auth = { authorization: `Bearer ${token}` }
    const direct = await (await fetch(url(`/api/play?path=${encodeURIComponent(join(dir, 'clip.mp4'))}&can=h264,aac,mp4`), { headers: auth })).json()
    expect(direct).toMatchObject({ mode: 'direct' })
    expect(direct.url).toContain('/m/')
    const hls = await (await fetch(url(`/api/play?path=${encodeURIComponent(join(dir, 'clip.mkv'))}&can=h264,aac,mp4`), { headers: auth })).json()
    expect(hls).toMatchObject({ mode: 'hls', copyVideo: true, duration: 10 })
    expect(hls.url).toMatch(/^\/hls\/[0-9a-f]{16}\/index\.m3u8\?t=/)
    const pl = await fetch(url(hls.url))
    expect(pl.status).toBe(200)
    expect(await pl.text()).toContain('2.m4s')
    const seg = await fetch(url(hls.url.replace('index.m3u8', '1.m4s')))
    expect(seg.status).toBe(200)
    expect(await seg.text()).toBe('seg1')
    expect((await fetch(url(hls.url.replace('index.m3u8', 'init.mp4')))).status).toBe(200)
    expect((await fetch(url(hls.url.replace('index.m3u8', '9.m4s')))).status).toBe(404)
  })
  it('/api/play is walled and needs a probe', async () => {
    const token = await pair()
    const auth = { authorization: `Bearer ${token}` }
    expect((await fetch(url('/api/play?path=C%3A%5CWindows%5Cx.mkv&can=h264'), { headers: auth })).status).toBe(403)
    const none = await (await fetch(url(`/api/play?path=${encodeURIComponent(join(dir, 'nothing.mkv'))}&can=h264`), { headers: auth })).json()
    expect(none).toMatchObject({ mode: 'none' })
  })
  it('an hls job belongs to the phone that opened it', async () => {
    const a = await pair()
    const hls = await (await fetch(url(`/api/play?path=${encodeURIComponent(join(dir, 'clip.mkv'))}&can=h264`), { headers: { authorization: `Bearer ${a}` } })).json()
    const b = await pair()
    expect((await fetch(url(hls.url.replace(/t=.*$/, `t=${b}`)))).status).toBe(404)
  })
```

- [ ] **Step 3: Implement in `server.ts`**

In `api()`:

```ts
      case 'play': {
        if (!inside()) return void json(res, 403, { error: 'outside the folder' })
        const info = await this.deps.probe(path)
        const ext = extname(path).toLowerCase()
        const plan = decide(info, ext, parseCan(q.get('can')))
        if (plan.mode === 'direct') return void json(res, 200, { mode: 'direct', url: `/m/${encodeURIComponent(path)}?t=${token}` , fps: info?.fps ?? null, duration: info?.duration ?? 0 })
        if (plan.mode === 'none') return void json(res, 200, plan)
        if (!this.deps.jobs || !info) return void json(res, 200, { mode: 'none', reason: 'Prism has no ffmpeg to convert with' })
        const { id } = this.deps.jobs.open({ token, file: path, plan, duration: info.duration, audioIndex: info.audio?.index ?? null })
        return void json(res, 200, { mode: 'hls', url: `/hls/${id}/index.m3u8?t=${token}`, copyVideo: plan.copyVideo, fps: info.fps, duration: info.duration })
      }
```

(`api()` needs the token: pass it through from `handle`.) And a new `hls()` handler for `route.kind === 'hls'`: the job id must equal `jobId(phone.token, <the job's file>)`, which the jobs class can answer with an `owner(id): string | null` method (add it: the job's token); mismatch is 404, never 403 (do not confirm a job exists). `index.m3u8` answers `playlistText` with `content-type: application/vnd.apple.mpegurl`; `init.mp4` streams the file with `video/mp4`; `<n>.m4s` awaits `jobs.segment(id, n)` and streams the file (`video/iso.segment`), 404 on null with the job's `lastError` in the JSON body. Every HLS response is `cache-control: no-store`. The server starts a 10s interval calling `jobs.reap()` in `start()` and clears it in `stop()` (and `jobs.stopAll()`).

In `src/main/index.ts` `phoneDeps()`: `probe: (p) => cachedProbe(p)` (factor the probe-with-cache out of the `media:probe` handler into a `const probeCached = async (p: string): Promise<MediaInfo | null>` used by both), `jobs: tools ? new HlsJobs({ ffmpeg: tools.ffmpeg, baseDir: join(app.getPath('userData'), 'phone', 'hls') }) : null`, created once; `rmSync` that base dir on startup (segments of a previous run are garbage) and `jobs.stopAll()` on `before-quit`.

- [ ] **Step 4: Tests, typecheck, lint. Commit**

```bash
git add src/main/phone src/main/index.ts
git commit -m "feat(phone): /api/play decides per device; /hls serves the playlist and live segments (#105)"
```

---

### Task 6: The phone side: what it can play, HLS through the reused players

**Files:**
- Create: `src/renderer/src/phone/canPlay.ts` + test
- Modify: `src/renderer/src/phone/prismShim.ts` (+ test), `src/renderer/src/phone/PhoneViewer.tsx`, `src/renderer/src/components/VideoView.tsx`, `src/renderer/src/components/AudioView.tsx`, `package.json` (hls.js, version 0.39.0)

**Interfaces:**
- `canPlay.ts`:
  ```ts
  export function canTokens(probe: (mime: string) => string, mse: boolean): string[]   // probe = el.canPlayType
  export function canCsv(): string                                                       // built once from a <video> and an <audio>
  export function nativeHls(): boolean
  ```
- `VideoView` and `AudioView` gain `attach?: (el: HTMLMediaElement) => () => void`: when given, the element renders WITHOUT `src` and `attach` runs in an effect keyed on `url`, its cleanup on change/unmount.
- The shim's `probeMedia(path)` returns `{ ffmpeg: true, needed: false, fps, convert: { reason: 'container', quick: copyVideo } }` when `/api/play` says hls, and `convertVideo(path)` resolves `{ url }` from the same cached answer; `mediaUrl` is unchanged (direct files never ask).

- [ ] **Step 1: canPlay test and implementation**

```ts
// src/renderer/src/phone/canPlay.test.ts
import { describe, expect, it } from 'vitest'
import { canTokens } from './canPlay'

const safari = (m: string): string =>
  /avc1|hvc1|mp4a\.40\.2|ac-3|ec-3|mpegurl|audio\/mpeg|audio\/flac|video\/mp4|audio\/mp4/.test(m) ? 'probably' : ''
const chrome = (m: string): string =>
  /avc1|vp9|av01|mp4a\.40\.2|opus|audio\/mpeg|audio\/flac|video\/mp4|video\/webm|audio\/wav|audio\/ogg/.test(m) ? 'probably' : ''

describe('canTokens', () => {
  it('reads Safari', () => {
    expect(canTokens(safari, false)).toEqual(expect.arrayContaining(['h264', 'hevc', 'aac', 'ac3', 'eac3', 'mp3', 'flac', 'mp4', 'hls-native']))
    expect(canTokens(safari, false)).not.toContain('vp9')
  })
  it('reads Chrome, where HLS needs hls.js and MSE', () => {
    const t = canTokens(chrome, true)
    expect(t).toEqual(expect.arrayContaining(['h264', 'vp9', 'av1', 'aac', 'opus', 'mp3', 'flac', 'wav', 'ogg', 'mp4', 'webm', 'mse']))
    expect(t).not.toContain('hls-native')
    expect(t).not.toContain('hevc')
  })
})
```

```ts
// src/renderer/src/phone/canPlay.ts
/** What THIS device plays, asked of the device (2026-09-06, #105): nothing is
 *  inferred from a user agent. Tokens are what `decide.ts` in main matches. */
const PROBES: Array<[string, string]> = [
  ['h264', 'video/mp4; codecs="avc1.640028"'],
  ['hevc', 'video/mp4; codecs="hvc1.1.6.L120.B0"'],
  ['vp9', 'video/webm; codecs="vp9"'],
  ['av1', 'video/mp4; codecs="av01.0.08M.08"'],
  ['aac', 'audio/mp4; codecs="mp4a.40.2"'],
  ['ac3', 'audio/mp4; codecs="ac-3"'],
  ['eac3', 'audio/mp4; codecs="ec-3"'],
  ['opus', 'audio/webm; codecs="opus"'],
  ['mp3', 'audio/mpeg'],
  ['flac', 'audio/flac'],
  ['wav', 'audio/wav'],
  ['ogg', 'audio/ogg'],
  ['mp4', 'video/mp4'],
  ['webm', 'video/webm'],
  ['hls-native', 'application/vnd.apple.mpegurl']
]

export function canTokens(probe: (mime: string) => string, mse: boolean): string[] {
  const out = PROBES.filter(([, mime]) => probe(mime) !== '').map(([t]) => t)
  if (mse) out.push('mse')
  return out
}

let cached: string | null = null
export function canCsv(): string {
  if (cached !== null) return cached
  const v = document.createElement('video')
  const a = document.createElement('audio')
  const probe = (mime: string): string => (mime.startsWith('audio/') ? a.canPlayType(mime) : v.canPlayType(mime)) as string
  cached = canTokens(probe, typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('video/mp4; codecs="avc1.640028,mp4a.40.2"')).join(',')
  return cached
}

export function nativeHls(): boolean {
  return document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== ''
}
```

- [ ] **Step 2: The shim**

Add to `prismShim.ts` a per-path cache `plays = new Map<string, Promise<PlayAnswer>>()` with `PlayAnswer = { mode: 'direct' | 'hls' | 'none'; url?: string; copyVideo?: boolean; fps?: number | null; duration?: number; reason?: string }`, `askPlay(path)` = `getJson('/api/play', { path, can: canCsv() })`, and:

```ts
  probeMedia: async (path: string): Promise<MediaProbe> => {
    const a = await askPlay(path)
    if (a.mode === 'hls') return { ffmpeg: true, needed: false, fps: a.fps ?? undefined, convert: { reason: 'container', quick: !!a.copyVideo } }
    if (a.mode === 'none') return { ffmpeg: false, needed: false }
    return { ffmpeg: true, needed: false, fps: a.fps ?? undefined }
  },
  convertVideo: async (path: string) => {
    const a = await askPlay(path)
    return a.mode === 'hls' && a.url ? { url: a.url } : { error: a.reason ?? 'Prism could not prepare this file' }
  },
  cancelConvert: () => {},
  onConvertProgress: () => () => {},
  playAnswer: askPlay  // the phone shell reads it to decide on hls.js
```

Export `askPlay` for `PhoneViewer`. Tests: mock `fetch` with `vi.stubGlobal` to answer `/api/play` and assert `probeMedia` maps hls to `convert.quick === copyVideo` and `convertVideo` returns the url; and that the second call for the same path does not fetch again.

- [ ] **Step 3: `attach` on VideoView and AudioView**

In `VideoView`, add the prop with this comment and wiring:

```tsx
  /** The phone's hls.js hook (2026-09-06, #105): a device with no native HLS
   *  needs a library to feed the element through MSE, and that library owns
   *  `src`. When given, the element is rendered WITHOUT src and `attach` is
   *  called with it; its return detaches. Nothing else in the viewer changes. */
  attach?: (el: HTMLMediaElement) => () => void
```

`src={attach ? undefined : src}` on the `<video>`, plus:

```ts
  useEffect(() => {
    const el = video.current
    if (!attach || !el) return
    return attach(el)
  }, [attach, src])
```

Same on `AudioView`'s `<audio>` (find its element and src; if AudioView's element comes through `useDecodedSource`, put the attach on the element that actually plays and skip decoded-source logic when `attach` is set).

- [ ] **Step 4: PhoneViewer uses it**

```ts
import Hls from 'hls.js' // dynamic: const { default: Hls } = await import('hls.js') inside the attach, so iOS never downloads it
```

In `PhoneViewer`, for `video` and `audio` kinds:

```ts
  const [answer, setAnswer] = useState<PlayAnswer | null>(null)
  useEffect(() => { let live = true; void askPlay(file.path).then((a) => live && setAnswer(a)); return () => { live = false } }, [file.path])
  const useHlsJs = answer?.mode === 'hls' && !nativeHls()
  const attach = useMemo(() => useHlsJs && answer?.url ? (el: HTMLMediaElement) => {
      let hls: { destroy(): void } | null = null
      let dead = false
      void import('hls.js').then(({ default: Hls }) => {
        if (dead || !Hls.isSupported()) return
        const h = new Hls({ enableWorker: true, lowLatencyMode: false })
        h.loadSource(answer.url!)
        h.attachMedia(el as HTMLVideoElement)
        hls = h
      })
      return () => { dead = true; hls?.destroy() }
    } : undefined, [useHlsJs, answer?.url])
```

Pass `attach={attach}` to `VideoView`/`AudioView`; render a "Preparing..." line until `answer` arrives, and `answer.reason` when `mode === 'none'`. Note `wasPlaying(url)` and friends key on `url` = the direct media url; with `attach` the `url` prop still goes in (it is the key), only `src` is withheld.

- [ ] **Step 5: Install hls.js, bump version, typecheck, lint, unit**

`npm i hls.js`, `"version": "0.39.0"`. `npm run typecheck && npm run lint && npm test`. Commit:

```bash
git add package.json package-lock.json src/renderer/src/phone src/renderer/src/components/VideoView.tsx src/renderer/src/components/AudioView.tsx
git commit -m "feat(phone): the phone reports what it plays and plays HLS natively or through hls.js (#105)"
```

---

### Task 7: E2E, measurement, notes

**Files:**
- Modify: `tools/e2e/run.mjs` (scenario `phoneHls`), `CLAUDE.md`, `README.md`

- [ ] **Step 1: The scenario**

Reuse `phoneScenario`'s pairing steps (factor a `pairPhone(win)` helper returning `{ base, token, root }` out of it) and then:

```js
async function phoneHlsScenario(fixtures) {
  console.log('phone: an mkv with Dolby audio plays over HLS, and seeks')
  const { app, win } = await launch(join(fixtures, 'av', 'dolby.mkv'))
  let page = null
  try {
    const { base, token } = await pairPhone(win)
    const auth = { authorization: `Bearer ${token}` }
    const play = await (await fetch(`${base}/api/play?path=${encodeURIComponent(join(fixtures, 'av', 'dolby.mkv'))}&can=h264,aac,mp4,mse`, { headers: auth })).json()
    ok(play.mode === 'hls' && play.copyVideo === true, 'an h264 mkv with ac3 is HLS with the picture copied')
    ok(Math.abs(play.duration - 6) < 1, 'the answer carries the duration')
    const pl = await (await fetch(`${base}${play.url}`)).text()
    ok(pl.includes('#EXT-X-PLAYLIST-TYPE:VOD') && pl.includes('1.m4s'), 'the playlist lists every segment up front')
    const t0 = Date.now()
    const seg0 = await fetch(`${base}${play.url.replace('index.m3u8', '0.m4s')}`)
    ok(seg0.status === 200 && (await seg0.arrayBuffer()).byteLength > 1000, `segment 0 arrives (${Date.now() - t0}ms)`)
    const init = await fetch(`${base}${play.url.replace('index.m3u8', 'init.mp4')}`)
    ok(init.status === 200, 'init.mp4 arrives')
    const seg1 = await fetch(`${base}${play.url.replace('index.m3u8', '1.m4s')}`)
    ok(seg1.status === 200, 'the last segment arrives')
    const xvid = await (await fetch(`${base}/api/play?path=${encodeURIComponent(join(fixtures, 'av', 'xvid.avi'))}&can=h264,aac,mp4,mse`, { headers: auth })).json()
    ok(xvid.mode === 'hls' && xvid.copyVideo === false, 'xvid is re-encoded')
    const xseg = await fetch(`${base}${xvid.url.replace('index.m3u8', '0.m4s')}`)
    ok(xseg.status === 200, 'a re-encoded segment arrives (nvenc, or openh264 if the GPU refused)')

    // Playback through hls.js in the app's Chromium (no native HLS there).
    page = await openPhoneWindow(app, `${base}/`)
    await page.evaluate((t) => localStorage.setItem('prism.phone.token', t), token)
    await page.reload()
    await page.waitForSelector('[data-phone-file]', { timeout: 10000 })
    await page.click('[data-phone-folder]:has-text("av")')
    await page.click('[data-phone-file]:has-text("dolby.mkv")')
    await page.waitForSelector('[data-phone-viewer][data-kind="video"] video', { timeout: 10000 })
    await page.evaluate(() => { const v = document.querySelector('video'); v.muted = true; return v.play() })
    await page.waitForFunction(() => (document.querySelector('video')?.currentTime ?? 0) > 0.5, null, { timeout: 20000 })
    ok(true, 'hls.js plays the stream')
    await page.evaluate(() => { document.querySelector('video').currentTime = 4.5 })
    await page.waitForFunction(() => { const v = document.querySelector('video'); return v.currentTime > 4.6 && !v.paused }, null, { timeout: 20000 })
    ok(true, 'a seek past the produced head lands where the playlist says (copyts)')
    ok(await page.evaluate(() => (document.querySelector('video')?.webkitDecodedFrameCount ?? 1) > 0), 'frames decode')
  } catch (e) {
    fail('phoneHls scenario crashed: ' + e)
  } finally {
    await page?.close().catch(() => {})
    await win.evaluate(() => window.prism.phoneSetOn(false, null)).catch(() => {})
    await app.close()
  }
}
```

Register it after `phoneScenario`. Run `npm run build && node tools/e2e/run.mjs phone` until both pass.

- [ ] **Step 2: Measure through the real route and write it down**

With the app running in dev (`npm run dev`, server on, a phone paired or a curl with the token), time `/api/play` + first segment for the two 4K films named in the header (`Zoolander 2001.mkv`, the Hellboy II remux), with `can=h264,aac,mp4` (forces an encode of HEVC, and a tone-map on the HDR one). Record: time to first segment, and ffmpeg's `speed=` from a debug log line (add a `PRISM_PHONE_DEBUG=1` env check that logs stderr's last line per job to the console, nothing else). These numbers, and the tone-map comparison, go into the CLAUDE.md note.

- [ ] **Step 3: CLAUDE.md and README**

Extend the phone paragraph in CLAUDE.md with a **transcode** paragraph in the file's voice: the playlist is Prism's, segments are ffmpeg's, `-copyts`, forced keyframes carrying the start time, forward slashes, per-device `can` tokens (never the user agent), copy over encode, HDR through libplacebo on Vulkan (measured 7.5x; OpenCL 0.7x, unusable; without a tone-map the picture is flat grey), the 1080p ceiling, AAC stereo, the openh264 fallback after one GPU refusal, hls.js only where HLS is not native, the 30s reap, and the segments directory wiped at start. README: one sentence under the phone paragraph.

- [ ] **Step 4: Gates and commit**

`npm run typecheck && npm run lint && npm test`, then the full e2e before push. Commit `test(phone): HLS e2e, measurements and notes (#105)`. Push, open the PR against `feat/104-phone-server`, package, install 0.39.0, poll the exe timestamp.
