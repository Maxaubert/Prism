// URL policy for the markdown viewer. Everything a rendered document may load
// or link to passes through here: web URLs and data images go through, local
// relative paths resolve against the document's own folder to fsmedia://, and
// anything else (javascript:, file:, protocol-relative) is dropped outright.
// Pure string work, no renderer APIs, so it is unit-testable.

const WEB = /^https?:\/\//i
const PASS = [/^data:image\//i, /^fsmedia:/i]
const DROP = [/^[a-z][a-z0-9+.-]*:/i, /^\/\//] // any other protocol, or //host

export const isExternal = (url: string): boolean => WEB.test(url)
export const isAnchor = (url: string): boolean => url.startsWith('#')

/** Join a relative markdown path onto the document's folder, Windows-style,
 *  collapsing `.` and `..` segments. Returns an absolute path. */
function joinBase(rel: string, baseDir: string): string {
  const parts = baseDir.replace(/[\\/]+$/, '').split(/[\\/]/)
  for (const seg of rel.split(/[\\/]/)) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (parts.length > 1) parts.pop() // never above the drive root
    } else parts.push(seg)
  }
  return parts.join('\\')
}

/**
 * The urlTransform handed to react-markdown: what a src/href becomes in the
 * rendered document. `''` means "drop it" (react-markdown renders no URL).
 */
export function resolveMdUrl(url: string, baseDir: string): string {
  if (!url) return ''
  if (WEB.test(url) || isAnchor(url)) return url
  if (PASS.some((p) => p.test(url))) return url
  if (DROP.some((p) => p.test(url))) return ''
  return `fsmedia://local/${encodeURIComponent(joinBase(url, baseDir))}`
}

/**
 * The absolute local path a relative link points at (for opening the target in
 * Prism), or null when the link is not a local file. Fragments and queries are
 * the document's business, not the path's.
 */
export function resolveLocalPath(url: string, baseDir: string): string | null {
  if (!url || WEB.test(url) || isAnchor(url)) return null
  if (PASS.some((p) => p.test(url)) || DROP.some((p) => p.test(url))) return null
  const bare = url.split(/[#?]/)[0]
  if (!bare) return null
  return joinBase(bare, baseDir)
}
