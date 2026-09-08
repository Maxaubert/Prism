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

/** The file-system path a relative markdown URL means: fragment and query are
 *  the document's business, not the path's, and the markdown pipeline has
 *  already percent-encoded the URL once (spaces, non-ASCII), so it is decoded
 *  back to the real name before it touches the disk path. */
function relativePath(url: string, baseDir: string): string {
  const bare = url.split(/[#?]/)[0]
  if (!bare) return ''
  let decoded = bare
  try {
    decoded = decodeURIComponent(bare)
  } catch {
    /* malformed %xx: take it literally */
  }
  return joinBase(decoded, baseDir)
}

/** The desktop's own scheme for a local file: what `window.prism.mediaUrl`
 *  answers there. The default, so every caller that never said otherwise
 *  keeps the URL it always got. */
export const fsmediaUrl = (path: string): string => `fsmedia://local/${encodeURIComponent(path)}`

/**
 * The urlTransform handed to react-markdown: what a src/href becomes in the
 * rendered document. `''` means "drop it" (react-markdown renders no URL).
 *
 * `toUrl` is the last step only (#106): the policy above decides WHETHER a
 * local file is named, and the host decides how one is fetched. The phone's
 * bridge answers `/m/<path>?t=<token>` where the desktop's answers
 * fsmedia://, and the viewer passes `window.prism.mediaUrl` so the same
 * document renders its pictures on both.
 */
export function resolveMdUrl(
  url: string,
  baseDir: string,
  toUrl: (path: string) => string = fsmediaUrl
): string {
  if (!url) return ''
  if (WEB.test(url) || isAnchor(url)) return url
  if (PASS.some((p) => p.test(url))) return url
  if (DROP.some((p) => p.test(url))) return ''
  const path = relativePath(url, baseDir)
  return path ? toUrl(path) : ''
}
