import type { FileKind } from './types'

// Extension -> kind. This is the seed of prism-core's fileKind (Phase 1); keep it
// in sync with Filesmith's so both apps agree on what "viewable" means.

const IMAGE = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif', '.jxl',
  // .jfif is a JPEG: Windows itself saves them under that name, and leaving it
  // out meant Prism refused a file it decodes perfectly.
  '.tiff', '.tif', '.ico', '.heic', '.heif', '.jfif',
  // Decoded by the bundled ffmpeg in main (imageDecode.ts), since Chromium
  // draws none of these: 2026-08-24.
  '.tga', '.targa', '.pcx', '.psd', '.exr', '.dpx', '.sgi', '.dds',
  '.ppm', '.pgm', '.pbm', '.pnm', '.jp2', '.j2k', '.qoi', '.hdr', '.xbm', '.xpm'
])
// Video is what CHROMIUM can decode, because Prism decodes audio and not
// picture: MPEG-2, Xvid, WMV, Theora and ProRes are deliberately absent, since
// opening one would show a black window (VideoView says so when it happens).
// The transport-stream family (.ts, .m2ts, .mts) is deliberately absent, and
// was MEASURED before being left out (2026-08-24): Chromium has no MPEG-TS
// demuxer for <video src>, so an .m2ts opened with picture missing and the
// error banner up, even though Prism decoded its AC-3 fine. Two more reasons
// not to force it: .ts and .mts are TypeScript, which this app's code viewer
// opens far more often, and telling them apart needs the file's first bytes
// (0x47 sync), not its name, while fileKind is name-only.
const VIDEO = new Set(['.mp4', '.m4v', '.webm', '.ogv', '.mov', '.mkv', '.avi'])
// Audio, on the other hand, is whatever FFMPEG can read: the sidecar turns any
// of it into PCM, so the container and codec stop mattering (2026-08-24).
const AUDIO = new Set([
  '.mp3', '.m4a', '.aac', '.ogg', '.opus', '.flac', '.wav',
  '.wma', '.ac3', '.dts', '.mka', '.aiff', '.aif', '.m4b', '.amr', '.ape', '.wv', '.au',
  '.dsf', '.dff', '.tta', '.caf', '.mpc', '.ra', '.m4r', '.oga', '.aifc', '.3ga'
])
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
  '.adoc', '.ipynb', '.gradle', '.cmake', '.mk', '.nix', '.zig',
  // 2026-08-24. Some of these (.cr, .scm, .lisp, .el) had a highlighter in
  // codeLang all along and simply never became viewable, which made the code
  // viewer claim languages it would not open. The rest is the sweep that
  // found them: build files, project files, and the plain-text odds and ends
  // people double-click.
  '.cr', '.scm', '.rkt', '.lisp', '.el', '.coffee', '.d', '.vbs', '.hx', '.sml',
  '.cob', '.cbl', '.ino', '.mdx', '.j2', '.jinja', '.nsi', '.nsh', '.lock',
  '.plist', '.csproj', '.vbproj', '.props', '.targets', '.resx', '.xsd', '.xsl',
  '.xslt', '.wsdl', '.desktop', '.service', '.inf', '.reg',
  '.awk', '.ahk', '.vim', '.po', '.pot', '.m3u', '.m3u8', '.sln', '.bib', '.tsv',
  // Subtitle formats Prism cannot yet RENDER over a video, but can perfectly
  // well show and edit as the text they are.
  '.ass', '.ssa', '.sub'
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
