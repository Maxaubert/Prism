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
  '.srt', '.vtt',
  // Source code (2026-08-17). Prism shows these with highlighting and edits
  // them in place; it never runs them. The list is "what someone double-clicks
  // and wants to read", not every extension a highlighter happens to know.
  '.mjs', '.cjs', '.mts', '.cts', '.py', '.pyw', '.rb', '.php', '.go', '.rs',
  '.java', '.kt', '.kts', '.scala', '.swift', '.dart', '.lua', '.pl', '.pm',
  '.r', '.jl', '.hs', '.ex', '.exs', '.erl', '.clj', '.cljs', '.elm', '.vb',
  '.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh', '.hxx', '.m', '.mm',
  '.cs', '.fs', '.fsx', '.ml', '.mli', '.groovy', '.pas', '.f90', '.tcl',
  '.v', '.sv', '.vhd', '.vhdl', '.asm', '.s',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.psm1', '.bat', '.cmd',
  '.sql', '.graphql', '.gql', '.proto', '.tf', '.tfvars',
  '.toml', '.cfg', '.conf', '.properties', '.env', '.editorconfig',
  '.scss', '.sass', '.less', '.styl', '.vue', '.svelte', '.astro',
  '.jsonc', '.json5', '.xhtml', '.svgz', '.diff', '.patch', '.tex', '.rst',
  '.adoc', '.ipynb', '.gradle', '.cmake', '.mk', '.nix', '.zig'
])

// Archives Prism can open in place (2026-08-22): zip only. Reading, renaming
// and deleting members means rewriting the container, which adm-zip does for
// zip; 7z and rar would need external binaries and stay unsupported.
const ARCHIVE = new Set(['.zip'])

// Files that carry their kind in the whole name, with no extension to read.
// Matched case-insensitively against the full filename.
const TEXT_NAMES = new Set([
  'dockerfile', 'containerfile', 'makefile', 'gnumakefile', 'cmakelists.txt',
  'rakefile', 'gemfile', 'brewfile', 'procfile', 'vagrantfile', 'jenkinsfile',
  'license', 'licence', 'copying', 'notice', 'authors', 'contributors',
  'readme', 'changelog', 'todo', 'install', 'news'
])

/**
 * The kind Prism shows a file as.
 *
 * `name` is optional and only consulted when the extension says nothing: some
 * files (`Dockerfile`, `Makefile`, `LICENSE`) and every dotfile (`.gitignore`,
 * `.npmrc`) carry their identity in the whole name. Callers that only have an
 * extension keep working unchanged, which is what Filesmith relies on.
 */
export function fileKind(ext: string, name?: string): FileKind {
  const e = ext.toLowerCase()
  if (IMAGE.has(e)) return 'image'
  if (VIDEO.has(e)) return 'video'
  if (AUDIO.has(e)) return 'audio'
  if (e === '.pdf') return 'pdf'
  if (ARCHIVE.has(e)) return 'archive'
  if (TEXT.has(e)) return 'text'
  if (name !== undefined && isTextName(name)) return 'text'
  return 'other'
}

/** True for anything Prism can show (used to filter a folder listing). */
export function isViewable(ext: string, name?: string): boolean {
  return fileKind(ext, name) !== 'other'
}

/** A whole-filename match: a known bare name, or a dotfile like `.gitignore`. */
function isTextName(name: string): boolean {
  const n = name.toLowerCase()
  if (TEXT_NAMES.has(n)) return true
  // A leading dot with no second dot is a config dotfile: `.gitignore`, `.npmrc`,
  // `.eslintrc`. `.eslintrc.json` already matched on its extension above.
  return n.startsWith('.') && n.length > 1 && !n.includes('.', 1)
}
