import { fileKind } from '@shared/fileKind'

/**
 * The archive panel's Type column: "HEIC image", "TypeScript source", "Folder".
 *
 * Explorer says "HEIC File" for everything it has no handler for, which tells
 * you nothing. Prism knows what it will DO with the member, so the noun comes
 * from the kind and the extension names the format: the row says both what it
 * is and that Prism can show it.
 */

const NOUN: Record<string, string> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  pdf: 'document',
  doc: 'document',
  archive: 'archive',
  comic: 'comic',
  text: 'text',
  other: 'file'
}

/** Extensions whose "text" is really source, so the noun earns a better word. */
const PROSE = new Set([
  '.txt',
  '.log',
  '.csv',
  '.tsv',
  '.srt',
  '.vtt',
  '.ass',
  '.ssa',
  '.nfo',
  '.rst'
])

/** A handful worth spelling out, where the bare extension is not the name. */
const NAMED: Record<string, string> = {
  '.md': 'Markdown',
  '.markdown': 'Markdown',
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.py': 'Python',
  '.rs': 'Rust',
  '.cs': 'C#',
  '.rb': 'Ruby',
  '.sh': 'Shell',
  '.ps1': 'PowerShell',
  '.jpg': 'JPEG',
  '.jpeg': 'JPEG',
  '.tif': 'TIFF',
  '.htm': 'HTML'
}

/** Markdown is kind 'text' but Prism RENDERS it, so it reads as a document. */
const MARKDOWN = new Set(['.md', '.markdown'])

export function typeLabel(name: string, dir: boolean): string {
  if (dir) return 'Folder'
  const ext = /\.[^.]+$/.exec(name.toLowerCase())?.[0] ?? ''
  if (!ext) return 'File'
  const kind = fileKind(ext, name)
  const noun = MARKDOWN.has(ext)
    ? 'document'
    : kind === 'text' && !PROSE.has(ext)
      ? 'source'
      : (NOUN[kind] ?? 'file')
  return `${NAMED[ext] ?? ext.slice(1).toUpperCase()} ${noun}`
}
