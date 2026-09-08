import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { delimiter, dirname, join } from 'path'

/**
 * The ffmpeg Prism bundles, and the arithmetic the audio sidecar is built on.
 *
 * Chromium ships no Dolby Digital (AC-3/E-AC-3), DTS or TrueHD decoder, so a
 * great many ordinary MKV rips play with picture and no sound. Prism decodes
 * those tracks itself: ffmpeg turns the track into raw PCM, and the renderer
 * plays that beside the muted-by-nature video (see audioSidecar.ts).
 *
 * The PCM shape below is FIXED, and that is the whole trick. A constant byte
 * rate makes a transcode seekable: byte N of the stream is always the sample
 * at (N - 44) / 192000 seconds, so a Range request can be answered by starting
 * ffmpeg at that timestamp. No temp files, no waiting for a whole movie to
 * convert, and seeking works like it does on a real file.
 */

/** 48 kHz, 16-bit, stereo: 192000 bytes per second, exactly. */
export const SIDECAR_RATE = 48000
export const SIDECAR_CHANNELS = 2
const BYTES_PER_SAMPLE = 2
export const BYTES_PER_FRAME = SIDECAR_CHANNELS * BYTES_PER_SAMPLE
export const BYTES_PER_SEC = SIDECAR_RATE * BYTES_PER_FRAME
export const WAV_HEADER_BYTES = 44

/**
 * What Chromium can decode on its own. An ALLOWLIST, not a blocklist: an
 * unknown codec gets the sidecar and plays, where a missed blocklist entry
 * would be silence. Transcoding something Chromium could have handled costs a
 * process; missing one costs the user their sound.
 */
const CHROMIUM_AUDIO = new Set([
  'aac',
  'mp3',
  'mp3float',
  'opus',
  'vorbis',
  'flac',
  'pcm_s16le',
  'pcm_s24le',
  'pcm_s32le',
  'pcm_f32le',
  'pcm_u8'
])

/**
 * Containers Chromium can pull apart on its own. The codec is only half the
 * question: Chromium has no demuxer for ASF, raw AC-3, DTS, AIFF or AU, so
 * even a track it could decode is unreachable inside one. Anything not on
 * this list is fed through the sidecar, which turns any container ffmpeg can
 * read into plain PCM.
 */
const CHROMIUM_CONTAINERS = new Set([
  '.mp4', '.m4v', '.m4a', '.m4b', '.mov', '.mkv', '.mka', '.webm', '.ogg', '.ogv',
  '.oga', '.opus', '.mp3', '.aac', '.flac', '.wav', '.avi'
  // MPEG-TS (.ts/.m2ts/.mts) is deliberately NOT here: measured 2026-08-24,
  // Chromium has no demuxer for it in <video src>, whatever it holds.
])

export function chromiumCanDemux(ext: string): boolean {
  return CHROMIUM_CONTAINERS.has(ext.toLowerCase())
}

export function needsSidecar(codec: string | undefined, ext?: string): boolean {
  if (ext !== undefined && !chromiumCanDemux(ext)) return true
  if (!codec) return false
  return !CHROMIUM_AUDIO.has(codec.toLowerCase())
}

/** The 44-byte RIFF/WAVE header for `dataBytes` of our PCM. */
export function wavHeader(dataBytes: number): Buffer {
  const b = Buffer.alloc(WAV_HEADER_BYTES)
  b.write('RIFF', 0, 'ascii')
  b.writeUInt32LE(36 + dataBytes, 4)
  b.write('WAVE', 8, 'ascii')
  b.write('fmt ', 12, 'ascii')
  b.writeUInt32LE(16, 16) // PCM fmt chunk size
  b.writeUInt16LE(1, 20) // format: PCM
  b.writeUInt16LE(SIDECAR_CHANNELS, 22)
  b.writeUInt32LE(SIDECAR_RATE, 24)
  b.writeUInt32LE(BYTES_PER_SEC, 28)
  b.writeUInt16LE(BYTES_PER_FRAME, 32)
  b.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34)
  b.write('data', 36, 'ascii')
  b.writeUInt32LE(dataBytes, 40)
  return b
}

/** Whole size of the virtual WAV for a track of this length. */
export function sidecarSize(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return WAV_HEADER_BYTES
  const frames = Math.floor(durationSec * SIDECAR_RATE)
  return WAV_HEADER_BYTES + frames * BYTES_PER_FRAME
}

/** The timestamp a byte offset of the virtual WAV stands for. */
export function timeForByte(byte: number): number {
  const pcm = Math.max(0, byte - WAV_HEADER_BYTES)
  // Land on a frame boundary: half a sample of skew would swap the channels
  // for the rest of the stream.
  return Math.floor(pcm / BYTES_PER_FRAME) / SIDECAR_RATE
}

/** Parse a Range header against a known total. null = no (or unusable) range. */
export function parseRange(header: string | null, total: number): { start: number; end: number } | null {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null
  if (!m[1] && !m[2]) return null
  let start: number
  let end: number
  if (!m[1]) {
    // "-N": the last N bytes.
    const n = parseInt(m[2], 10)
    if (!Number.isFinite(n) || n <= 0) return null
    start = Math.max(0, total - n)
    end = total - 1
  } else {
    start = parseInt(m[1], 10)
    end = m[2] ? parseInt(m[2], 10) : total - 1
  }
  if (!Number.isFinite(start) || start < 0) return null
  if (!Number.isFinite(end) || end >= total) end = total - 1
  if (start > end) return null
  return { start, end }
}

/** Stream index standing for "whichever audio track comes first", for the
 *  blind route where nothing probed the file. */
export const FIRST_AUDIO = -1

/** The ffmpeg argv for streaming one track as our PCM, from `at` seconds. */
export function sidecarArgs(file: string, streamIndex: number, at: number): string[] {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-nostdin',
    // -ss BEFORE -i: ffmpeg seeks the container and decodes from there, which
    // is what keeps a seek cheap on a 4K movie.
    ...(at > 0 ? ['-ss', at.toFixed(6)] : []),
    '-i', file,
    '-vn', '-sn', '-dn',
    '-map', streamIndex === FIRST_AUDIO ? '0:a:0' : `0:${streamIndex}`,
    '-ac', String(SIDECAR_CHANNELS),
    '-ar', String(SIDECAR_RATE),
    '-acodec', 'pcm_s16le',
    '-f', 's16le',
    'pipe:1'
  ]
}

export interface MediaInfo {
  audio: AudioTrack | null
  /** EVERY audio stream, in file order (2026-08-28). `audio` is the one that
   *  plays by default; this is what the track picker offers. */
  tracks: AudioTrack[]
  /** The video stream's codec, when the file has one. Prism does not decode
   *  video, so this exists to NAME what it cannot show rather than leave a
   *  black window with no explanation. */
  videoCodec: string | null
  /** The picture's shape, when the file has one (2026-09-06, #105). The
   *  phone transcode needs the height for its 1080p ceiling and the transfer
   *  to tell HDR from SDR: an HDR picture scaled without a tone-map comes out
   *  flat grey, and only the transfer says which one a file is. */
  video: { width: number; height: number; pixFmt: string; transfer: string } | null
  /** Frames per second, when the file has a video stream that says. Frame
   *  stepping is a lie without it: a step of 1/30 on 24fps film moves most of
   *  a frame and lands between two of them. */
  fps: number | null
  duration: number
}

export interface AudioTrack {
  /** Absolute stream index, for -map 0:N. */
  index: number
  /** The track's own name, when the file carries one ("Commentary"). */
  title: string
  codec: string
  channels: number
  layout: string
  language: string
  /** Container duration, seconds. */
  duration: number
}

interface ProbeStream {
  codec_type?: string
  index?: number
  codec_name?: string
  /** "30000/1001" and friends. avg is the honest one for a whole file; r is
   *  the container's nominal rate and is what a variable-rate file reports. */
  avg_frame_rate?: string
  r_frame_rate?: string
  channels?: number
  channel_layout?: string
  width?: number
  height?: number
  pix_fmt?: string
  /** "smpte2084" (HDR10), "arib-std-b67" (HLG), "bt709" (SDR). */
  color_transfer?: string
  disposition?: { default?: number }
  tags?: { language?: string; title?: string }
}

/**
 * What the file holds: the audio track Chromium itself would play (its
 * default, else the first - Prism offers no track picker), and whether there
 * is a video stream at all.
 */
export function readProbe(json: string): MediaInfo | null {
  let parsed: { streams?: ProbeStream[]; format?: { duration?: string } }
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  const streams = parsed.streams ?? []
  const duration = Number(parsed.format?.duration) || 0
  const audios = streams.filter((s) => s.codec_type === 'audio')
  const video = streams.find((s) => s.codec_type === 'video')
  const pick = audios.find((s) => s.disposition?.default === 1) ?? audios[0]
  const toTrack = (s: ProbeStream): AudioTrack | null =>
    typeof s.index === 'number' && s.codec_name
      ? {
          index: s.index,
          title: s.tags?.title ?? '',
          codec: s.codec_name,
          channels: s.channels ?? 0,
          layout: s.channel_layout ?? '',
          language: s.tags?.language ?? '',
          duration
        }
      : null
  const tracks = audios.map(toTrack).filter((t): t is AudioTrack => t !== null)
  const audio = pick ? toTrack(pick) : null
  if (!audio && !video) return null
  return {
    audio,
    tracks,
    videoCodec: video?.codec_name ?? null,
    video:
      video && typeof video.width === 'number' && typeof video.height === 'number'
        ? { width: video.width, height: video.height, pixFmt: video.pix_fmt ?? '', transfer: video.color_transfer ?? '' }
        : null,
    fps: frameRate(video),
    duration
  }
}

// ---------------------------------------------------------------------------
// Finding the binaries
// ---------------------------------------------------------------------------

/**
 * Where ffmpeg lives. Packaged: resources/bin, put there by electron-builder
 * from vendor/ffmpeg (tools/fetch-ffmpeg.mjs). Unpackaged (dev, e2e): the
 * vendor folder itself. PATH is a last resort so a clone that skipped the
 * fetch still works.
 *
 * Only paths Prism enumerates itself are ever spawned - the same rule the
 * "Open in" menu and the 7-Zip lookup follow.
 */
export function ffmpegDirs(packaged: boolean, resourcesPath: string, appPath: string): string[] {
  const dirs: string[] = []
  if (packaged) dirs.push(join(resourcesPath, 'bin'))
  // Unpackaged, appPath is wherever the main script sits - the repo root under
  // `npm run dev`, out/main when e2e runs the built bundle - so walk up looking
  // for the vendor folder rather than guessing which one it is today.
  let up = appPath
  for (let i = 0; i < 4; i++) {
    dirs.push(join(up, 'vendor', 'ffmpeg'))
    const parent = dirname(up)
    if (parent === up) break
    up = parent
  }
  for (const p of (process.env.PATH ?? '').split(delimiter)) {
    if (p.trim()) dirs.push(p.trim())
  }
  return dirs
}

export interface FfmpegTools {
  ffmpeg: string
  ffprobe: string | null
}

let cached: FfmpegTools | null | undefined

export function findFfmpeg(packaged: boolean, resourcesPath: string, appPath: string): FfmpegTools | null {
  if (cached !== undefined) return cached
  for (const dir of ffmpegDirs(packaged, resourcesPath, appPath)) {
    const ffmpeg = join(dir, 'ffmpeg.exe')
    if (!existsSync(ffmpeg)) continue
    const ffprobe = join(dir, 'ffprobe.exe')
    cached = { ffmpeg, ffprobe: existsSync(ffprobe) ? ffprobe : null }
    return cached
  }
  cached = null
  return null
}

/** Test seam: forget what findFfmpeg settled on. */
export function resetFfmpeg(): void {
  cached = undefined
}

const PROBE_ARGS = [
  '-v', 'error',
  '-print_format', 'json',
  '-show_entries',
  'stream=index,codec_type,codec_name,channels,channel_layout,disposition,avg_frame_rate,r_frame_rate,width,height,pix_fmt,color_transfer:stream_tags=language,title:format=duration'
]

/**
 * Frames per second, from ffprobe's rational strings ("30000/1001").
 *
 * avg_frame_rate first, since it is measured over the file; r_frame_rate is
 * the container's nominal rate and reads "90000/1" on some streams, which is
 * a timebase rather than a frame rate. Anything outside plausible video is
 * refused rather than believed.
 */
function frameRate(video: ProbeStream | undefined): number | null {
  for (const raw of [video?.avg_frame_rate, video?.r_frame_rate]) {
    if (!raw) continue
    const [n, d] = raw.split('/')
    const fps = Number(n) / (Number(d) || 1)
    if (Number.isFinite(fps) && fps > 0.5 && fps <= 480) return fps
  }
  return null
}

/** Ask ffprobe what a file carries. null when it cannot say. */
export async function probeMedia(ffprobe: string, file: string): Promise<MediaInfo | null> {
  const json = await new Promise<string | null>((resolve) => {
    execFile(ffprobe, [...PROBE_ARGS, file], { timeout: 15000, maxBuffer: 4 << 20 }, (err, stdout) =>
      resolve(err ? null : stdout)
    )
  })
  return json ? readProbe(json) : null
}
