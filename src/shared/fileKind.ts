import type { FileKind } from './types'

// Extension -> kind. This is the seed of prism-core's fileKind (Phase 1); keep it
// in sync with Filesmith's so both apps agree on what "viewable" means.

const IMAGE = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif', '.jxl',
  '.tiff', '.tif', '.ico', '.heic', '.heif'
])
const VIDEO = new Set(['.mp4', '.m4v', '.webm', '.ogv', '.mov', '.mkv', '.avi'])
const AUDIO = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.opus', '.flac', '.wav'])
const TEXT = new Set([
  '.txt', '.md', '.markdown', '.json', '.js', '.ts', '.tsx', '.jsx', '.css',
  '.html', '.xml', '.yml', '.yaml', '.ini', '.log', '.csv',
  // Subtitles are text too (2026-08-12): view one, fix a line, save it.
  '.srt', '.vtt'
])

export function fileKind(ext: string): FileKind {
  const e = ext.toLowerCase()
  if (IMAGE.has(e)) return 'image'
  if (VIDEO.has(e)) return 'video'
  if (AUDIO.has(e)) return 'audio'
  if (e === '.pdf') return 'pdf'
  if (TEXT.has(e)) return 'text'
  return 'other'
}

/** True for anything Prism can show (used to filter a folder listing). */
export function isViewable(ext: string): boolean {
  return fileKind(ext) !== 'other'
}
