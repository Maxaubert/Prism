import { extname } from 'path'
import { decodableImages } from './imageDecode'

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
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.jfif': 'image/jpeg',
  '.webp': 'image/webp',
  // Decoded to PNG before they ever reach the renderer (imageDecode.ts).
  ...Object.fromEntries(decodableImages().map((e) => [e, 'image/png'])),
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
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
