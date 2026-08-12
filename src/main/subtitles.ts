import { readdirSync, readFileSync } from 'fs'
import { basename, dirname, extname, join } from 'path'

// Sidecar subtitles, the convention every player follows: "Episode.mkv" is
// subtitled by "Episode.srt" / "Episode.en.srt" / "Episode.vtt" in the same
// folder (or a Subs/ subfolder), so a hundred-episode season needs zero clicks.
// Chromium renders WebVTT natively; SRT differs only in trivia, so it is
// converted rather than parsed. Embedded (in-container) tracks need a demuxer
// and are deliberately not attempted.

export interface SubTrack {
  path: string
  /** What the menu shows: a language name when the suffix gives one. */
  label: string
}

const SUB_EXTS = new Set(['.srt', '.vtt'])
const SUB_DIRS = ['subs', 'sub', 'subtitles']

/** "en" / "eng" / "en-US" -> "English"; anything unknown comes back as itself. */
function languageLabel(token: string): string | null {
  if (!/^[a-z]{2,3}(-[a-z]{2,4})?$/i.test(token)) return null
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(token.toLowerCase())
    // Intl echoes unknown codes back; an echo is not a language name.
    return name && name.toLowerCase() !== token.toLowerCase() ? name : token
  } catch {
    return null
  }
}

/**
 * The sidecar names that belong to `videoName`, from one folder's file list.
 * A match is the video's stem, optionally followed by dot-separated qualifiers
 * ("Movie.en.srt", "Movie.en.forced.srt"), with a subtitle extension.
 */
export function matchSubs(videoName: string, names: string[]): Array<{ name: string; label: string }> {
  const stem = videoName.slice(0, videoName.length - extname(videoName).length)
  const out: Array<{ name: string; label: string }> = []
  for (const name of names) {
    const ext = extname(name).toLowerCase()
    if (!SUB_EXTS.has(ext)) continue
    const subStem = name.slice(0, name.length - ext.length)
    if (subStem.toLowerCase() === stem.toLowerCase()) {
      out.push({ name, label: 'Subtitles' })
      continue
    }
    if (!subStem.toLowerCase().startsWith(stem.toLowerCase() + '.')) continue
    const qualifiers = subStem.slice(stem.length + 1).split('.')
    const lang = qualifiers.map(languageLabel).find(Boolean)
    out.push({ name, label: lang ?? qualifiers.join(' ') })
  }
  return out
}

/**
 * SRT -> WebVTT. The differences that matter: the header line, dot decimal
 * separators in timestamps, and SRT's habit of decimal-less or CRLF-happy
 * files. Cue text (including <i>/<b> tags, which VTT also understands) passes
 * through untouched.
 */
export function srtToVtt(srt: string): string {
  const body = srt
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    // "00:01:02,345 --> 00:01:04,000" - the comma is the whole disagreement.
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
  return 'WEBVTT\n\n' + body.trim() + '\n'
}

/** The tracks on disk for a video: its own folder, then the Subs/ variants. */
export function sidecarsFor(videoPath: string): SubTrack[] {
  const dir = dirname(videoPath)
  const video = basename(videoPath)
  const out: SubTrack[] = []
  const scan = (folder: string): void => {
    let names: string[]
    try {
      names = readdirSync(folder)
    } catch {
      return // no such folder; nothing to add
    }
    for (const m of matchSubs(video, names)) out.push({ path: join(folder, m.name), label: m.label })
  }
  scan(dir)
  for (const sub of SUB_DIRS) {
    const real = (() => {
      try {
        return readdirSync(dir).find((n) => n.toLowerCase() === sub)
      } catch {
        return undefined
      }
    })()
    if (real) scan(join(dir, real))
  }
  return out
}

/** A track's text as WebVTT, whatever it was on disk. */
export function readAsVtt(path: string): string | null {
  const ext = extname(path).toLowerCase()
  if (!SUB_EXTS.has(ext)) return null
  try {
    const text = readFileSync(path, 'utf-8')
    return ext === '.srt' ? srtToVtt(text) : text
  } catch {
    return null
  }
}
