import { extname } from 'path'
import { imageExtensions } from '@shared/fileKind'
import { isHeic } from './heicClient'
import { needsImageDecode } from './imageDecode'
import { isRaw } from './rawPreview'

/** The pictures Chromium draws itself, served as they are. */
const NATIVE_IMAGE: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon'
}

/**
 * The type of a picture, by the copy the renderer receives (#31).
 *
 * The image list is fileKind's, not a second one kept here: the two drifted
 * once (2026-08-05 review), and `.ico` reached the renderer as octet-stream,
 * missing the whole-buffer fast path. What main converts is typed as what it
 * makes: PNG from ffmpeg (TIFF, JPEG XL, PSD...), JPEG from a HEIC or from a
 * raw's embedded preview. A picture none of these can draw gets no type, and
 * `mime.test.ts` fails on it.
 *
 * Those converted entries are bookkeeping, not what goes on the wire:
 * mediaProtocol answers raw, HEIC and ffmpeg pictures itself, with the type
 * of the copy it made, before it ever asks `mediaMime` (review, 2026-10-31).
 * They are here so the parity test can tell "converted" from "nothing can
 * draw this". In practice #31 changed one served type, `.ico`'s.
 */
function imageMime(e: string): string | undefined {
  if (NATIVE_IMAGE[e]) return NATIVE_IMAGE[e]
  // The predicates read a path's extension, and `extname('.tif')` is ''.
  const file = `a${e}`
  if (needsImageDecode(file)) return 'image/png'
  if (isHeic(file) || isRaw(file)) return 'image/jpeg'
  return undefined
}

/**
 * Every content type main serves, in one place (stage 9b of the structure
 * cleanup, 2026-10-12). Three tables, because they answer three different
 * servers and merging them would change what each one says:
 *
 * - `mediaMime`: fsmedia:// (and the phone's `/m/`, which goes through it).
 * - `assetMime`: the phone server's own page and its assets.
 * - `HLS_MIME`: what the phone plays from an HLS job directory.
 */
const MEDIA: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  // Served only until the converted copy exists (videoConvert.ts).
  '.wmv': 'video/x-ms-wmv',
  '.asf': 'video/x-ms-asf',
  '.flv': 'video/x-flv',
  '.f4v': 'video/x-f4v',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.mpe': 'video/mpeg',
  '.m1v': 'video/mpeg',
  '.m2v': 'video/mpeg',
  '.mpv': 'video/mpeg',
  '.m2ts': 'video/mp2t',
  '.vob': 'video/dvd',
  '.3gp': 'video/3gpp',
  '.3g2': 'video/3gpp2',
  '.divx': 'video/x-msvideo',
  '.mxf': 'application/mxf',
  '.rm': 'application/vnd.rn-realmedia',
  '.rmvb': 'application/vnd.rn-realmedia-vbr',
  '.ogm': 'video/ogg',
  '.dv': 'video/x-dv',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  // The rest reach the player as decoded PCM (audioSidecar), so these types
  // only matter for the few Chromium can read by itself.
  '.mka': 'audio/x-matroska',
  '.m4b': 'audio/mp4',
  '.wma': 'audio/x-ms-wma',
  '.ac3': 'audio/ac3',
  '.dts': 'audio/vnd.dts',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff',
  '.amr': 'audio/amr',
  '.ape': 'audio/x-ape',
  '.wv': 'audio/x-wavpack',
  '.au': 'audio/basic',
  // Every picture, from fileKind's list (#31): see `imageMime`.
  ...Object.fromEntries(
    imageExtensions().flatMap((e) => {
      const type = imageMime(e)
      return type ? [[e, type]] : []
    })
  ),
  '.pdf': 'application/pdf'
}

/** fsmedia://'s type for a file; anything unlisted is octet-stream. */
export const mediaMime = (p: string): string =>
  MEDIA[extname(p).toLowerCase()] ?? 'application/octet-stream'

const ASSET: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  // pdf.js's worker is an ES module file (#106): without this a module
  // worker gets application/octet-stream and the browser refuses it.
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.bcmap': 'application/octet-stream'
}

/** The phone page's type for one of its own files. */
export const assetMime = (p: string): string =>
  ASSET[extname(p).toLowerCase()] ?? 'application/octet-stream'

/** What the phone plays from a job directory, by file: the playlist Prism
 *  wrote, ffmpeg's init segment and its media segments. Nothing else there
 *  has a type because nothing else there is served. */
export const HLS_MIME: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.mp4': 'video/mp4',
  '.m4s': 'video/iso.segment'
}
