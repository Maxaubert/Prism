import type { MediaProps, TextProps } from '@shared/props'
import { parentDir } from '@shared/path'
import { formatWhen } from './format'

/**
 * How the Properties window words its facts (owner, 2026-10-12; spec
 * `docs/superpowers/specs/2026-10-12-properties-window-design.md`). Pure, so
 * every phrase the mockups settled is held by a test rather than by eye.
 */

/** 12345 -> "12,345": counts read the way Explorer writes them. */
export function count(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

/** "9 Oct 2026, 21:14", the mockup's date; empty for a time nobody gave. */
export function whenLabel(ms: number | undefined): string {
  return formatWhen(ms).replace(/ (\d\d:\d\d)$/, ', $1')
}

/** "1.6 MP": one decimal, which is how cameras print it. */
export function megapixels(width: number, height: number): string {
  return `${((width * height) / 1e6).toFixed(1)} MP`
}

/**
 * "3840 × 2160 (4K)". The name goes by the picture's short side, so a
 * portrait phone film (1080 × 1920) is 1080p as it should be; an odd size
 * between the steps gets no name rather than a wrong one.
 */
export function resolutionLabel(width: number, height: number): string {
  const long = Math.max(width, height)
  const short = Math.min(width, height)
  const name =
    long >= 7680 ? '8K' : long >= 3840 || short >= 2160 ? '4K' : short >= 1440 ? '1440p' : short >= 1080 ? '1080p' : short >= 720 ? '720p' : ''
  return `${width} × ${height}${name ? ` (${name})` : ''}`
}

/** "60 fps", "29.97 fps", "23.976 fps". */
export function fpsLabel(fps: number): string {
  return `${Number(fps.toFixed(3))} fps`
}

/** "H.264 (High), 8-bit", "HEVC (H.265), Main 10, 10-bit, HDR10". */
export function videoLabel(video: NonNullable<MediaProps['video']>): string {
  const head = video.profile
    ? video.codec.includes('(')
      ? `${video.codec}, ${video.profile}`
      : `${video.codec} (${video.profile})`
    : video.codec
  return [head, video.bitDepth ? `${video.bitDepth}-bit` : '', video.hdr ?? ''].filter(Boolean).join(', ')
}

/** A film's bitrate in Mb/s ("32.0 Mb/s"), a song's in kb/s ("871 kb/s"). */
export function bitrateLabel(bps: number, unit: 'video' | 'audio'): string {
  return unit === 'video' && bps >= 1e6 ? `${(bps / 1e6).toFixed(1)} Mb/s` : `${count(bps / 1000)} kb/s`
}

/** "44.1 kHz", "48 kHz". */
export function khz(rate: number): string {
  return `${Number((rate / 1000).toFixed(1))} kHz`
}

type AudioTrack = MediaProps['audio'][number]

/** "stereo", "5.1(side)": ffprobe's own word, else one made from the count. */
export function layoutLabel(track: AudioTrack): string {
  if (track.layout) return track.layout
  if (!track.channels) return ''
  return track.channels === 1 ? 'mono' : track.channels === 2 ? 'stereo' : `${track.channels} channels`
}

/** A song's format: "FLAC, 16-bit, 44.1 kHz, stereo". */
export function audioFormat(track: AudioTrack): string {
  return [
    track.codec,
    track.bitDepth ? `${track.bitDepth}-bit` : '',
    track.sampleRate ? khz(track.sampleRate) : '',
    layoutLabel(track)
  ]
    .filter(Boolean)
    .join(', ')
}

/** A film's audio track: "AAC, 48 kHz, stereo" (the bit depth is noise there). */
export function trackLabel(track: AudioTrack): string {
  return [track.codec, track.sampleRate ? khz(track.sampleRate) : '', layoutLabel(track)].filter(Boolean).join(', ')
}

// The containers write ISO 639-2 ("eng"); Intl only names the two-letter
// codes, so the common ones are mapped down first. Anything else is shown as
// the container wrote it.
const ISO2: Record<string, string> = {
  eng: 'en', nor: 'no', nob: 'nb', nno: 'nn', swe: 'sv', dan: 'da', fin: 'fi', isl: 'is', ice: 'is',
  ger: 'de', deu: 'de', fre: 'fr', fra: 'fr', spa: 'es', ita: 'it', por: 'pt', dut: 'nl', nld: 'nl',
  pol: 'pl', rus: 'ru', ukr: 'uk', cze: 'cs', ces: 'cs', hun: 'hu', gre: 'el', ell: 'el', tur: 'tr',
  ara: 'ar', heb: 'he', hin: 'hi', jpn: 'ja', kor: 'ko', chi: 'zh', zho: 'zh', tha: 'th', vie: 'vi',
  ind: 'id', may: 'ms', msa: 'ms', rum: 'ro', ron: 'ro', bul: 'bg', hrv: 'hr', srp: 'sr', slv: 'sl',
  slo: 'sk', slk: 'sk', est: 'et', lav: 'lv', lit: 'lt', per: 'fa', fas: 'fa'
}

/** "eng" -> "English"; "und" (undetermined) is no language at all. */
export function languageName(code: string | undefined): string {
  const c = code?.trim().toLowerCase()
  if (!c || c === 'und') return ''
  const tag = ISO2[c] ?? c
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(tag)
    return name && name.toLowerCase() !== tag ? name : code!.trim()
  } catch {
    return code!.trim()
  }
}

/** What a track is called: its language, else its title, else its number. */
export function trackName(track: { language?: string; title?: string }, index: number): string {
  return languageName(track.language) || track.title?.trim() || `Track ${index + 1}`
}

/** The subtitles line: languages in order, "None" when the file has none. */
export function subtitlesLabel(subs: MediaProps['subtitles']): string {
  return subs.length ? subs.map((s, i) => trackName(s, i)).join(', ') : 'None'
}

/** "UTF-8, no BOM"; the other encodings say just their name. */
export function encodingLabel(text: TextProps): string {
  return text.encoding === 'UTF-8' ? `UTF-8, ${text.bom ? 'with BOM' : 'no BOM'}` : text.encoding
}

const EOL: Record<TextProps['eol'], string> = {
  LF: 'LF (Unix)',
  CRLF: 'CRLF (Windows)',
  CR: 'CR (classic Mac)',
  Mixed: 'Mixed',
  None: 'None (one line)'
}

export function eolLabel(eol: TextProps['eol']): string {
  return EOL[eol]
}

/** Lines, words and characters of a text. A final newline ends the last
 *  line rather than starting an empty one, as an editor counts. */
export function textCounts(text: string): { lines: number; words: number; chars: number } {
  if (!text) return { lines: 0, words: 0, chars: 0 }
  let lines = text.split(/\r\n|\r|\n/).length
  if (/(\r\n|\r|\n)$/.test(text)) lines -= 1
  return { lines, words: text.split(/\s+/).filter(Boolean).length, chars: text.length }
}

/** A SHA-256 shortened in the middle: the first 16 and the last 12. */
export function shortHash(hex: string): string {
  return hex.length > 29 ? `${hex.slice(0, 16)}…${hex.slice(-12)}` : hex
}

/** The folder a path sits in: the header's dim line. A drive root keeps its
 *  separator ("C:\"), which `parentDir` leaves off. */
export function headerParent(path: string): string {
  const parent = parentDir(path)
  return /^[a-z]:$/i.test(parent) ? `${parent}\\` : parent
}

/** Created, Modified and Opened, each only when the file system said. */
export function dateFacts(
  stat: { mtimeMs: number; birthtimeMs?: number; atimeMs?: number } | null
): Array<{ label: string; value: string }> {
  if (!stat) return []
  const rows: Array<[string, number | undefined]> = [
    ['Created', stat.birthtimeMs],
    ['Modified', stat.mtimeMs],
    ['Opened', stat.atimeMs]
  ]
  return rows.flatMap(([label, ms]) => {
    const value = whenLabel(ms)
    return value ? [{ label, value }] : []
  })
}
