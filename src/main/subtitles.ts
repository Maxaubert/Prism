import { execFileSync } from 'child_process'
import { readdirSync, readFileSync, statSync } from 'fs'
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

const SUB_EXTS = new Set(['.srt', '.vtt', '.ass', '.ssa'])
// SubStation Alpha carries positioning, fonts and colours that WebVTT has no
// way to express, so ffmpeg converts it and the styling is dropped: the lines
// and their timings survive, which is the part a viewer needs. Everything else
// here is plain text and needs no help.
const FFMPEG_SUBS = new Set(['.ass', '.ssa'])
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

/** The tracks on disk for a video: its own folder, then the Subs/ variants.
 *  One readdir of the folder, reused for both the sidecars and the Subs/
 *  lookup: this runs in the main process, and disks can be network shares. */
export function sidecarsFor(videoPath: string): SubTrack[] {
  const dir = dirname(videoPath)
  const video = basename(videoPath)
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const out: SubTrack[] = matchSubs(video, names).map((m) => ({
    path: join(dir, m.name),
    label: m.label
  }))
  for (const sub of SUB_DIRS) {
    const real = names.find((n) => n.toLowerCase() === sub)
    if (!real) continue
    let subNames: string[]
    try {
      subNames = readdirSync(join(dir, real))
    } catch {
      continue // a file wearing a folder's name, or unreadable
    }
    for (const m of matchSubs(video, subNames)) {
      out.push({ path: join(dir, real, m.name), label: m.label })
    }
  }
  return out
}

// A subtitle file is kilobytes; a "subtitle file" this big is something else
// wearing the extension, and reading it would stall the main process.
const MAX_SUB_BYTES = 5 * 1024 * 1024

/** Drop STYLE and REGION blocks: they are the one part of WebVTT that can
 *  reference the network (::cue background url(...)), and a downloaded
 *  subtitle must not get to phone home just by being displayed. WebVTT is
 *  blank-line-separated blocks, so it is filtered as blocks. */
export function stripVttStyles(vtt: string): string {
  return vtt
    .split(/\r?\n[ \t]*\r?\n/)
    .filter((block) => !/^(?:STYLE|REGION)\b/.test(block.trimStart()))
    .join('\n\n')
}

/** A track's text as WebVTT, whatever it was on disk. */
export function readAsVtt(path: string, ffmpeg?: string | null): string | null {
  const ext = extname(path).toLowerCase()
  if (!SUB_EXTS.has(ext)) return null
  try {
    if (statSync(path).size > MAX_SUB_BYTES) return null
    if (FFMPEG_SUBS.has(ext)) {
      if (!ffmpeg) return null
      const r = execFileSync(ffmpeg, assToVttArgs(path), { timeout: 15000, maxBuffer: MAX_SUB_BYTES * 2 })
      return stripVttStyles(r.toString('utf-8'))
    }
    const text = readFileSync(path, 'utf-8')
    return stripVttStyles(ext === '.srt' ? srtToVtt(text) : text)
  } catch {
    return null
  }
}

/** ffmpeg argv for "this subtitle file, as WebVTT, on stdout". */
export function assToVttArgs(path: string): string[] {
  return ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', path, '-map', '0:s:0', '-f', 'webvtt', 'pipe:1']
}
