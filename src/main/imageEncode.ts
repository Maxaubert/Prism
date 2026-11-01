import { stat } from 'fs/promises'
import { extOf } from '@shared/path'
import type { CopyFormat } from '@shared/imageCopy'
import { execFile } from './spawnWorker'

/**
 * A PICTURE SAVED AS ANOTHER FORMAT, BY THE BUNDLED FFMPEG (#474; owner,
 * 2026-11-01). The Explorer's "Save copies as" makes every copy here, and the
 * picture's own "Save a copy" makes its WebP, AVIF and JPEG XL here from the
 * PNG the canvas drew.
 *
 * THE QUALITY, PICKED AND MEASURED 2026-11-01 on a 4032x3024 photo with the
 * bundled ffmpeg 9.0.1 (no setting: the owner asked for sensible defaults):
 * - JPEG `-q:v 1`: its tables come closest to the canvas's 0.92 (a libjpeg
 *   quality 92 JPEG of the same photo was 5.22 MB, q:v 1 5.32 MB, q:v 2
 *   4.53 MB). On white, as the single save.
 * - PNG lossless (the encoder's own).
 * - WebP quality 90, AVIF (libaom, still picture) crf 18, JPEG XL distance 1
 *   (libjxl's own "visually lossless" point).
 * Times on that photo: JPEG 0.3 s, JPEG XL 0.8 s, AVIF 1.0 s, WebP 1.2 s,
 * PNG 1.9 s.
 *
 * NO METADATA (privacy, as the single save): `-map_metadata -1` drops the
 * container's, and the EXIF side data ffmpeg 9 carries on each frame is
 * deleted (AV_FRAME_DATA_EXIF, 31: this build's `sidedata` filter lists no
 * name for it). Without that a PNG and a JPEG XL still carried the camera's
 * EXIF. ffmpeg turns the picture by its EXIF orientation first, so the copy
 * stands the way the viewer shows it.
 *
 * ALPHA is kept where the format has it. PNG, WebP and JPEG XL negotiate it
 * themselves; AVIF carries it as a second, grey picture (two streams), and
 * JPEG has none, so a clear picture goes onto white.
 */

/** Sources whose pictures can carry an alpha channel. */
const ALPHA_EXTS = new Set([
  '.png', '.apng', '.webp', '.gif', '.tga', '.targa', '.tif', '.tiff', '.psd',
  '.avif', '.jxl', '.ico', '.bmp', '.qoi', '.dds', '.exr', '.sgi', '.xpm', '.jp2', '.j2k'
])

export const mayCarryAlpha = (ext: string): boolean => ALPHA_EXTS.has(ext.toLowerCase())

/** An ffmpeg pixel format with an alpha channel (a palette may hold a clear
 *  colour, so it counts). */
export const alphaPixFmt = (pixFmt: string): boolean =>
  /^(pal8|ya|yuva|gbrap|rgba|bgra|argb|abgr)/.test(pixFmt)

export interface EncodeOpts {
  /** The source has an alpha channel (or may: JPEG needs no proof). */
  alpha: boolean
  /** EXR or Radiance HDR: linear light, tone-mapped as the viewer does. */
  hdr: boolean
}

const NO_EXIF = 'sidedata=mode=delete:type=31'
const TONEMAP = 'format=gbrpf32le,tonemap=hable:desat=0,format=rgba'

const CODEC: Record<CopyFormat, string[]> = {
  jpeg: ['-c:v', 'mjpeg', '-qmin', '1', '-q:v', '1', '-f', 'image2'],
  png: ['-c:v', 'png', '-f', 'image2'],
  webp: ['-c:v', 'libwebp', '-quality', '90', '-compression_level', '4', '-f', 'webp'],
  // The avif muxer cannot write to a pipe ("does not support non seekable
  // output"), which is why every copy goes to a file.
  avif: ['-c:v', 'libaom-av1', '-still-picture', '1', '-crf', '18', '-b:v', '0', '-cpu-used', '6', '-row-mt', '1', '-f', 'avif'],
  jxl: ['-c:v', 'libjxl', '-distance', '1', '-effort', '7', '-f', 'image2']
}

/** ffmpeg argv: `input`'s first frame as `format`, written to `out`. */
export function encodeArgs(input: string, out: string, format: CopyFormat, o: EncodeOpts): string[] {
  const head = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', input, '-frames:v', '1', '-map_metadata', '-1']
  const base = [...(o.hdr ? [TONEMAP] : []), NO_EXIF].join(',')
  let picture: string[]
  if (format === 'jpeg' && o.alpha) {
    picture = [
      '-filter_complex',
      `[0:v]${base},format=rgba,split[a][b];[a]drawbox=c=white:replace=1:t=fill[w];[w][b]overlay=format=auto[v]`,
      '-map',
      '[v]'
    ]
  } else if (format === 'avif' && o.alpha) {
    picture = [
      '-filter_complex',
      `[0:v]${base},format=rgba,split[c][a];[c]format=yuv420p[cc];` +
        // MEASURED: libaom refuses the grey plane while it is still tagged
        // RGB ("Subsampling must be 0 with AOM_CICP_MC_IDENTITY").
        '[a]alphaextract,format=gray,setparams=colorspace=bt709:range=pc[al]',
      '-map',
      '[cc]',
      '-map',
      '[al]'
    ]
  } else if (format === 'avif') {
    // 4:2:0, the AVIF every decoder reads; an RGB source would otherwise
    // reach libaom as gbrp, which it refuses the same way.
    picture = ['-vf', `${base},format=yuv420p`]
  } else picture = ['-vf', base]
  return [...head, ...picture, ...CODEC[format], out]
}

export interface Encoder {
  ffmpeg: string
  /** Absent, an AVIF of a source that may be clear keeps an alpha picture
   *  (opaque when the source was): never a lost alpha. */
  ffprobe: string | null
}

/** Does the picture in `file` have an alpha channel (ffprobe's pixel format). */
export function probeAlpha(ffprobe: string, file: string, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      ffprobe,
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=pix_fmt', '-of', 'csv=p=0', file],
      { timeout: 20000, signal },
      (err, stdout) => resolve(!err && alphaPixFmt(String(stdout).trim()))
    )
  })
}

/**
 * Encode `input` (a file ffmpeg reads) as `format` into `out`. True when a
 * non-empty file was written. Runs in the process worker: main never starts
 * a process itself, and never waits on one.
 */
export async function encodeImage(
  tools: Encoder,
  input: string,
  out: string,
  format: CopyFormat,
  signal?: AbortSignal
): Promise<boolean> {
  const ext = extOf(input)
  let alpha = mayCarryAlpha(ext)
  // A JPEG on white costs nothing when the picture is opaque; AVIF's second
  // picture would, so it asks first.
  if (alpha && format === 'avif' && tools.ffprobe) alpha = await probeAlpha(tools.ffprobe, input, signal)
  if (signal?.aborted) return false
  const args = encodeArgs(input, out, format, { alpha, hdr: ext === '.exr' || ext === '.hdr' })
  const ok = await new Promise<boolean>((resolve) => {
    execFile(tools.ffmpeg, args, { timeout: 180000, maxBuffer: 1 << 20, signal }, (err) => resolve(!err))
  })
  if (!ok) return false
  return stat(out).then((s) => s.size > 0, () => false)
}
