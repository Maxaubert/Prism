import { execFile, spawn } from 'child_process'
import { stat } from 'fs/promises'
import type { MediaProps } from '@shared/props'

/**
 * WHAT A FILM OR A SONG HOLDS, for the Properties window (owner, 2026-10-12;
 * spec `docs/superpowers/specs/2026-10-12-properties-window-design.md`).
 *
 * ffprobe's `-show_format -show_streams` answer, read by a pure parser into
 * the window's facts: the picture, every audio track, the subtitles and the
 * music tags. `media:probe` asks a narrower question (what PLAYS) and keeps
 * its own parser in `ffmpeg.ts`; this one only describes.
 *
 * The picture at the top of the window (`props:picture`) is ffmpeg writing
 * one JPEG to stdout, a frame 10% into a film or a song's own cover, so the
 * page gets a `data:` URL and nothing new crosses the root wall.
 */

interface Stream {
  index?: number
  codec_type?: string
  codec_name?: string
  profile?: string
  width?: number
  height?: number
  avg_frame_rate?: string
  r_frame_rate?: string
  pix_fmt?: string
  bits_per_raw_sample?: string | number
  bits_per_sample?: number
  color_transfer?: string
  side_data_list?: Array<{ side_data_type?: string }>
  channels?: number
  channel_layout?: string
  sample_rate?: string | number
  disposition?: { attached_pic?: number; default?: number }
  tags?: Record<string, string | undefined>
}

interface Probe {
  streams?: Stream[]
  format?: { duration?: string; bit_rate?: string; tags?: Record<string, string | undefined> }
}

const CODECS: Record<string, string> = {
  h264: 'H.264',
  hevc: 'HEVC (H.265)',
  av1: 'AV1',
  vp9: 'VP9',
  vp8: 'VP8',
  mpeg4: 'MPEG-4',
  mpeg2video: 'MPEG-2',
  mpeg1video: 'MPEG-1',
  mjpeg: 'Motion JPEG',
  prores: 'ProRes',
  theora: 'Theora',
  wmv3: 'WMV',
  vc1: 'VC-1',
  aac: 'AAC',
  mp3: 'MP3',
  mp2: 'MP2',
  flac: 'FLAC',
  alac: 'ALAC',
  opus: 'Opus',
  vorbis: 'Vorbis',
  ac3: 'AC-3',
  eac3: 'E-AC-3',
  truehd: 'TrueHD',
  mlp: 'MLP',
  dts: 'DTS',
  wavpack: 'WavPack',
  ape: "Monkey's Audio",
  wmav2: 'WMA',
  wmapro: 'WMA Pro',
  wmalossless: 'WMA Lossless',
  amr_nb: 'AMR',
  subrip: 'SRT',
  srt: 'SRT',
  ass: 'ASS',
  ssa: 'SSA',
  webvtt: 'WebVTT',
  mov_text: 'MOV text',
  hdmv_pgs_subtitle: 'PGS',
  dvd_subtitle: 'VobSub',
  dvb_subtitle: 'DVB'
}

/** ffprobe's codec name as people say it: h264 is "H.264", hevc "HEVC (H.265)". */
export function prettyCodec(name: string, profile?: string): string {
  const n = name.toLowerCase()
  // DTS's profile IS its name ("DTS-HD MA"), and HE-AAC is not plain AAC.
  if (n === 'dts' && profile) return profile
  if (n === 'aac' && profile && /^HE/i.test(profile)) return profile
  if (n.startsWith('pcm_')) return 'PCM'
  return CODECS[n] ?? name.toUpperCase()
}

/** Frames per second from "24000/1001", refusing a timebase ("90000/1"). */
function frameRate(s: Stream): number | undefined {
  for (const raw of [s.avg_frame_rate, s.r_frame_rate]) {
    if (!raw) continue
    const [n, d] = raw.split('/')
    const fps = Number(n) / (Number(d) || 1)
    if (Number.isFinite(fps) && fps > 0.5 && fps <= 480) return Math.round(fps * 1000) / 1000
  }
  return undefined
}

const positive = (v: unknown): number | undefined => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** A picture's bits per sample: ffprobe's own count, else the pixel format's
 *  ("yuv420p10le" is 10, "yuv420p" 8). */
function videoBitDepth(s: Stream): number | undefined {
  const raw = positive(s.bits_per_raw_sample)
  if (raw) return raw
  const fmt = s.pix_fmt ?? ''
  const deep = /p(\d{1,2})(le|be)$/.exec(fmt)
  if (deep) return Number(deep[1])
  if (/^(yuvj?4[124][024]p|nv12|nv21|gray|rgb24|bgr24|rgba|bgra)$/.test(fmt)) return 8
  return undefined
}

/** "HDR10", "HLG" or "Dolby Vision" from the transfer and side data; SDR is none. */
function hdrOf(s: Stream): string | undefined {
  if ((s.side_data_list ?? []).some((d) => /DOVI/i.test(d.side_data_type ?? '')))
    return 'Dolby Vision'
  if (s.color_transfer === 'smpte2084') return 'HDR10'
  if (s.color_transfer === 'arib-std-b67') return 'HLG'
  return undefined
}

const language = (tags?: Record<string, string | undefined>): string | undefined => {
  const l = (tags?.language ?? tags?.LANGUAGE ?? '').trim()
  return l && l.toLowerCase() !== 'und' ? l : undefined
}
const title = (tags?: Record<string, string | undefined>): string | undefined =>
  (tags?.title ?? tags?.TITLE ?? '').trim() || undefined

const isCover = (s: Stream): boolean =>
  s.codec_type === 'video' && s.disposition?.attached_pic === 1

/** The container's tags first, then the audio streams' (an Ogg or Opus file
 *  keeps them there), keys compared without case. */
function tagReader(probe: Probe): (...keys: string[]) => string | undefined {
  const all = new Map<string, string>()
  const add = (tags?: Record<string, string | undefined>): void => {
    for (const [k, v] of Object.entries(tags ?? {})) {
      const key = k.toLowerCase()
      const value = (v ?? '').trim()
      if (value && !all.has(key)) all.set(key, value)
    }
  }
  add(probe.format?.tags)
  for (const s of probe.streams ?? []) if (s.codec_type === 'audio') add(s.tags)
  return (...keys) => {
    for (const k of keys) {
      const v = all.get(k)
      if (v) return v
    }
    return undefined
  }
}

function musicTags(probe: Probe): MediaProps['tags'] {
  const tag = tagReader(probe)
  const out: MediaProps['tags'] = {}
  const t = tag('title')
  if (t) out.title = t
  const artist = tag('artist', 'album_artist', 'albumartist', 'album artist')
  if (artist) out.artist = artist
  const album = tag('album')
  if (album) out.album = album
  const year = /\d{4}/.exec(tag('date', 'year', 'originaldate', 'original_year') ?? '')?.[0]
  if (year) out.year = year
  // "3", "3/10" or "03 of 10", with the total maybe in a tag of its own.
  const [num, of] = (tag('track', 'tracknumber') ?? '').split('/')
  const track = positive(parseInt(num, 10))
  if (track) out.track = track
  const total =
    positive(parseInt(of ?? '', 10)) ??
    positive(parseInt(tag('tracktotal', 'totaltracks') ?? '', 10))
  if (total) out.trackTotal = total
  const genre = tag('genre')
  if (genre) out.genre = genre
  return out
}

function parse(json: string | Probe): Probe | null {
  if (typeof json !== 'string') return json
  try {
    const probe = JSON.parse(json) as Probe
    return probe && typeof probe === 'object' ? probe : null
  } catch {
    return null
  }
}

/** ffprobe's JSON (`-show_format -show_streams`) as the window's facts.
 *  null when it is not JSON or holds neither picture nor sound. */
export function readMediaProps(json: string | Probe): MediaProps | null {
  const probe = parse(json)
  if (!probe) return null
  const streams = probe.streams ?? []
  const film = streams.find((s) => s.codec_type === 'video' && !isCover(s))
  const audios = streams.filter((s) => s.codec_type === 'audio' && s.codec_name)
  if (!film && !audios.length) return null

  const out: MediaProps = {
    audio: [],
    subtitles: [],
    tags: musicTags(probe),
    cover: streams.some(isCover)
  }
  const duration =
    positive(probe.format?.duration) ??
    Math.max(0, ...streams.map((s) => positive((s as { duration?: string }).duration) ?? 0))
  if (duration) out.duration = duration
  const bitrate = positive(probe.format?.bit_rate)
  if (bitrate) out.bitrate = bitrate

  if (film && film.codec_name && positive(film.width) && positive(film.height)) {
    const video: NonNullable<MediaProps['video']> = {
      width: film.width!,
      height: film.height!,
      codec: prettyCodec(film.codec_name)
    }
    const fps = frameRate(film)
    if (fps) video.fps = fps
    if (film.profile) video.profile = film.profile
    const depth = videoBitDepth(film)
    if (depth) video.bitDepth = depth
    const hdr = hdrOf(film)
    if (hdr) video.hdr = hdr
    out.video = video
  }

  for (const s of audios) {
    const track: MediaProps['audio'][number] = { codec: prettyCodec(s.codec_name!, s.profile) }
    const lang = language(s.tags)
    if (lang) track.language = lang
    const name = title(s.tags)
    // A song's title tag lives on the stream in some containers: that is the
    // song's name, not a track name.
    if (name && film) track.title = name
    const channels = positive(s.channels)
    if (channels) track.channels = channels
    if (s.channel_layout) track.layout = s.channel_layout
    const rate = positive(s.sample_rate)
    if (rate) track.sampleRate = rate
    const depth = positive(s.bits_per_raw_sample) ?? positive(s.bits_per_sample)
    if (depth) track.bitDepth = depth
    out.audio.push(track)
  }

  for (const s of streams) {
    if (s.codec_type !== 'subtitle') continue
    const sub: MediaProps['subtitles'][number] = {}
    const lang = language(s.tags)
    if (lang) sub.language = lang
    const name = title(s.tags)
    if (name) sub.title = name
    if (s.codec_name) sub.codec = prettyCodec(s.codec_name)
    out.subtitles.push(sub)
  }
  return out
}

/** Where the window's picture comes from: a frame of the film 10% in, else
 *  the file's own cover. null when it has neither. */
export function pictureSource(json: string | Probe): { stream: number; at: number } | null {
  const probe = parse(json)
  if (!probe) return null
  const streams = probe.streams ?? []
  const film = streams.find(
    (s) => s.codec_type === 'video' && !isCover(s) && typeof s.index === 'number'
  )
  if (film) {
    const duration = positive(probe.format?.duration) ?? 0
    return { stream: film.index!, at: Math.round(duration * 0.1 * 1000) / 1000 }
  }
  const cover = streams.find((s) => isCover(s) && typeof s.index === 'number')
  return cover ? { stream: cover.index!, at: 0 } : null
}

/** ffmpeg argv for one JPEG, PICTURE_WIDTH wide, on stdout. The seek goes
 *  before the input (a fast seek); a cover has none. */
export const PICTURE_WIDTH = 380
export function pictureArgs(file: string, source: { stream: number; at: number }): string[] {
  return [
    '-v',
    'error',
    ...(source.at > 0 ? ['-ss', String(source.at)] : []),
    '-i',
    file,
    '-map',
    `0:${source.stream}`,
    '-frames:v',
    '1',
    '-vf',
    `scale=${PICTURE_WIDTH}:-2`,
    '-f',
    'image2pipe',
    '-c:v',
    'mjpeg',
    'pipe:1'
  ]
}

export const PROBE_TIMEOUT = 15_000
export const PICTURE_TIMEOUT = 15_000
const PICTURE_MAX = 8 << 20

// The window asks for the facts and the picture of the same file at once:
// one probe answers both, keyed by the file's size and time so an edited
// file is asked again.
const probes = new Map<string, Promise<string | null>>()

async function probeJson(ffprobe: string, file: string): Promise<string | null> {
  let key: string
  try {
    const info = await stat(file)
    key = `${file}|${info.size}|${info.mtimeMs}`
  } catch {
    return null
  }
  const known = probes.get(key)
  if (known) return known
  const run = new Promise<string | null>((resolve) => {
    execFile(
      ffprobe,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
      { timeout: PROBE_TIMEOUT, maxBuffer: 8 << 20, windowsHide: true },
      (err, stdout) => resolve(err ? null : stdout)
    )
  })
  probes.set(key, run)
  if (probes.size > 8) probes.delete(probes.keys().next().value!)
  void run.then((json) => {
    if (json === null) probes.delete(key)
  })
  return run
}

/** `props:media`: the facts, or null when ffprobe could not say. */
export async function mediaProps(ffprobe: string, file: string): Promise<MediaProps | null> {
  const json = await probeJson(ffprobe, file)
  return json ? readMediaProps(json) : null
}

/** `props:picture`: one JPEG as a `data:` URL, or null. */
export async function mediaPicture(
  ffmpeg: string,
  ffprobe: string,
  file: string
): Promise<string | null> {
  const json = await probeJson(ffprobe, file)
  const source = json ? pictureSource(json) : null
  if (!source) return null
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(ffmpeg, pictureArgs(file, source), {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore']
      })
    } catch {
      resolve(null)
      return
    }
    const chunks: Buffer[] = []
    let bytes = 0
    let settled = false
    const finish = (value: string | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (child.exitCode === null) child.kill()
      resolve(value)
    }
    const timer = setTimeout(() => finish(null), PICTURE_TIMEOUT)
    child.stdout!.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > PICTURE_MAX) return finish(null)
      chunks.push(chunk)
    })
    child.on('error', () => finish(null))
    child.on('close', (code) => {
      const jpeg = Buffer.concat(chunks)
      // A JPEG starts FF D8; anything else is not a picture.
      finish(
        code === 0 && jpeg.length > 2 && jpeg[0] === 0xff && jpeg[1] === 0xd8
          ? `data:image/jpeg;base64,${jpeg.toString('base64')}`
          : null
      )
    })
  })
}
