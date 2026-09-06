/**
 * HLS the way a live transcode can seek (2026-09-06, #105). Prism writes the
 * PLAYLIST itself: every segment of the whole film, four seconds each, VOD,
 * so the scrubber knows the duration from the first byte and can ask for
 * segment 400 before segment 2 exists. ffmpeg only makes segment FILES, from
 * whatever segment it was started at, with `-copyts` so a segment's own
 * timestamps say where in the film it is: without that a job restarted at
 * minute 30 would produce a segment claiming to be minute 0. Keyframes are
 * FORCED on the boundary (measured: `-hls_time 4` alone gave 10.4s segments,
 * NVENC's GOP deciding) and the expression carries the start time, or every
 * frame after a restart becomes a keyframe until n_forced catches up.
 * Paths go to ffmpeg with FORWARD slashes: its HLS muxer finds the output
 * directory by the last '/', and with backslashes wrote init.mp4 into the
 * current directory (measured).
 *
 * Pure: no fs, no spawn. The job class beside this owns the process.
 */
import { createHash } from 'crypto'
import { join } from 'path'
import type { PlayPlan } from './decide'

export const SEGMENT_SECONDS = 4
/** How far ahead of the produced head a request may be and still wait: at
 *  7-15x realtime three segments is under a second, and anything further
 *  is a seek, which a restart answers in about a second (measured). */
const WAIT_AHEAD = 3

export function fwd(p: string): string {
  return p.replace(/\\/g, '/')
}

export function segmentCount(duration: number): number {
  return Math.max(1, Math.ceil(duration / SEGMENT_SECONDS))
}

/** The whole film as a VOD playlist of fMP4 segments, written before a
 *  single one exists. The last segment carries the remainder; a film that
 *  ends on a boundary has no zero-length tail because `ceil` never makes
 *  one. */
export function playlistText(duration: number): string {
  const n = segmentCount(duration)
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    `#EXT-X-TARGETDURATION:${SEGMENT_SECONDS}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-INDEPENDENT-SEGMENTS',
    '#EXT-X-MAP:URI="init.mp4"'
  ]
  for (let i = 0; i < n; i++) {
    const len = i === n - 1 ? Math.max(0.1, duration - i * SEGMENT_SECONDS) : SEGMENT_SECONDS
    lines.push(`#EXTINF:${len.toFixed(6)},`, `${i}.m4s`)
  }
  lines.push('#EXT-X-ENDLIST')
  return lines.join('\n') + '\n'
}

/** One job per phone and file: the same phone asking for the same file
 *  lands on the same job, however the path was cased. */
export function jobId(token: string, file: string): string {
  return createHash('sha256').update(`${token}|${file.toLowerCase()}`).digest('hex').slice(0, 16)
}

export function segmentFile(outDir: string, n: number): string {
  return join(outDir, `${n}.m4s`)
}

export interface Encoder {
  video: 'nvenc' | 'openh264'
}

/** HDR to SDR on the GPU: libplacebo over Vulkan, bt.2390 tone-mapping to
 *  bt709 (measured 7.5x realtime at 4K; scale_cuda alone left the picture
 *  flat grey). The decoder hands system-memory p010 frames (no cuda output
 *  format on this path) and they are uploaded to Vulkan for the filter. */
const TONEMAP_GPU = (h: number | null): string =>
  `format=p010,hwupload,libplacebo=${h ? `w=-2:h=${h}:` : ''}tonemapping=bt.2390:colorspace=bt709:color_primaries=bt709:color_trc=bt709:format=yuv420p,hwdownload,format=yuv420p`
/** The CPU fallback: zscale to linear, hable, back to bt709 (measured 6x). */
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
  // Hardware decode is asked for only when the picture is being encoded: a
  // copy never touches the frames, and audio-only has no frames to touch.
  const pre: string[] = []
  if (encodeVideo && gpu) {
    if (plan.tonemap) pre.push('-init_hw_device', 'vulkan=vk', '-filter_hw_device', 'vk', '-hwaccel', 'cuda')
    else pre.push('-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda')
  }
  let filter: string
  if (plan.tonemap) filter = gpu ? TONEMAP_GPU(plan.height) : TONEMAP_CPU(plan.height)
  else if (gpu) filter = `scale_cuda=${plan.height ? `-2:${plan.height}` : 'iw:ih'}:format=nv12`
  else filter = `${plan.height ? `scale=-2:${plan.height},` : ''}format=yuv420p`
  const video: string[] = plan.audioOnly
    ? ['-vn']
    : plan.copyVideo
      ? ['-map', '0:v:0', '-c:v', 'copy']
      : [
          '-map',
          '0:v:0',
          '-vf',
          filter,
          ...(gpu
            ? ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '23', '-b:v', '0', '-maxrate', '12M', '-bufsize', '24M', '-profile:v', 'high']
            : // libopenh264, since the bundled build is LGPL and has no x264.
              ['-c:v', 'libopenh264', '-b:v', '6000k', '-profile:v', 'high']),
          '-force_key_frames',
          `expr:gte(t,${start}+n_forced*${SEGMENT_SECONDS})`
        ]
  const audio: string[] =
    o.audioIndex === null
      ? ['-an']
      : ['-map', `0:${o.audioIndex}`, ...(plan.copyAudio ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-ac', '2', '-b:a', '192k'])]
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-y',
    ...pre,
    ...(start > 0 ? ['-ss', start.toFixed(6)] : []),
    '-i',
    o.file,
    ...video,
    ...audio,
    '-sn',
    '-dn',
    '-copyts',
    '-f',
    'hls',
    '-hls_time',
    String(SEGMENT_SECONDS),
    '-hls_segment_type',
    'fmp4',
    '-hls_playlist_type',
    'vod',
    // temp_file: a segment appears under its final name only when it is
    // COMPLETE, which is what the job code leans on to know what exists.
    '-hls_flags',
    'temp_file+independent_segments',
    '-start_number',
    String(o.startSegment),
    '-hls_fmp4_init_filename',
    'init.mp4',
    '-hls_segment_filename',
    `${fwd(o.outDir)}/%d.m4s`,
    `${fwd(o.outDir)}/ffmpeg.m3u8`
  ]
}

export type JobAction = 'serve' | 'wait' | 'restart'

/** What a segment ask means for the running job. `produced` is the highest
 *  COMPLETE segment index the job has written, -1 for none yet. A segment
 *  behind the job's start is one it will never make; one a little ahead of
 *  the head is on its way; one far ahead is a seek. */
export function nextAction(o: { startSegment: number; produced: number; wanted: number; total: number }): JobAction {
  if (o.wanted < o.startSegment) return 'restart'
  if (o.wanted <= o.produced) return 'serve'
  const head = Math.max(o.produced, o.startSegment - 1)
  return o.wanted - head <= WAIT_AHEAD ? 'wait' : 'restart'
}

/** Did ffmpeg refuse for want of the GPU path? Then the job code drops to
 *  software for the session rather than paying the refusal on every seek. */
export function looksLikeGpuFailure(stderr: string): boolean {
  return /nvcuda|nvenc|cuda|OpenEncodeSession|No NVENC capable|hwaccel|vulkan|libplacebo/i.test(stderr)
}
