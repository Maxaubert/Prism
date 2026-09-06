/**
 * What THIS device plays, asked of the device (2026-09-06, #105): nothing is
 * inferred from a user agent. Each token is one `canPlayType` question, and
 * the tokens are exactly what `decide.ts` in main matches, so a phone that
 * plays HEVC gets its HEVC copied into the segments and one that does not
 * gets it encoded. "maybe" counts as yes: `canPlayType` never says
 * "probably" for a bare container, and a maybe on `video/mp4` is every
 * browser there is.
 *
 * `mse` is the one token that is not a codec or a container: it says
 * hls.js could feed the element, which is how an Android plays HLS at all.
 */
const PROBES: ReadonlyArray<readonly [string, string]> = [
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

const HLS_MIME = 'application/vnd.apple.mpegurl'
/** What the segments carry when Prism encodes: H.264 high + AAC-LC. */
const HLS_MSE_MIME = 'video/mp4; codecs="avc1.640028,mp4a.40.2"'

/** The tokens, from a `canPlayType` and whether MSE can take the encode. */
export function canTokens(probe: (mime: string) => string, mse: boolean): string[] {
  const out = PROBES.filter(([, mime]) => probe(mime) !== '').map(([t]) => t)
  if (mse) out.push('mse')
  return out
}

let cached: string | null = null

/** The csv `/api/play` takes, built once from a `<video>` and an `<audio>`:
 *  what a device plays does not change while the page is open. */
export function canCsv(): string {
  if (cached !== null) return cached
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return ''
  const v = document.createElement('video')
  const a = document.createElement('audio')
  const probe = (mime: string): string => (mime.startsWith('audio/') ? a : v).canPlayType(mime)
  const mse = typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(HLS_MSE_MIME)
  cached = canTokens(probe, mse).join(',')
  return cached
}

/** Whether a `<video src="x.m3u8">` plays here by itself (iPhone, iPad);
 *  anywhere else the playlist goes through hls.js. */
export function nativeHls(): boolean {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return false
  return document.createElement('video').canPlayType(HLS_MIME) !== ''
}
