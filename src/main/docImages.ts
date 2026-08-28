import { existsSync } from 'fs'
import { dirname, extname, isAbsolute, resolve } from 'path'

/**
 * The pictures a document asks for (2026-08-28).
 *
 * `fsmedia://` is walled to the session roots, and that broke a common README:
 * a doc in `docs/` pointing at `../assets/logo.png` shows a picture that lives
 * OUTSIDE the folder Prism opened in, and the wall refused it - measured, and
 * a regression against the markdown viewer's own relative-path resolver.
 *
 * The grant is the DOCUMENT'S, not the renderer's: main reads the markdown it
 * is about to hand over, takes the image references out of it, and allows
 * exactly those files. A page cannot ask for a path the document does not
 * name, which is the difference between this and widening the wall.
 */
const IMAGE_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.bmp',
  '.svg',
  '.ico',
  '.tif',
  '.tiff'
])

/** How many one document may grant. A file with ten thousand references is not
 *  a document; the cap stops a pathological one filling the set. */
const MAX_GRANTS = 200

const MD_IMAGE = /!\[[^\]]*\]\(\s*<?([^)>\s]+)/g
const HTML_IMAGE = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi

/** Everything the text points at that is a local image file which exists. */
export function documentImages(docPath: string, text: string): string[] {
  const dir = dirname(docPath)
  const out: string[] = []
  const seen = new Set<string>()
  for (const re of [MD_IMAGE, HTML_IMAGE]) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null && out.length < MAX_GRANTS) {
      const raw = m[1].trim()
      // Anything with a scheme is somebody else's problem: http(s) is blocked
      // by the page's own CSP, data: carries its bytes with it, and fsmedia://
      // is already walled by the rule this exists to soften.
      if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) continue
      let rel = raw.split('#')[0].split('?')[0]
      try {
        rel = decodeURIComponent(rel)
      } catch {
        /* a name with a stray % is still a name */
      }
      if (!rel) continue
      const full = isAbsolute(rel) ? resolve(rel) : resolve(dir, rel)
      const key = full.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      if (!IMAGE_EXTS.has(extname(full).toLowerCase())) continue
      if (!existsSync(full)) continue
      out.push(full)
    }
  }
  return out
}

export function isMarkdownPath(p: string): boolean {
  return /\.(md|markdown|mdx|mkd|mdown|mkdn|mk)$/i.test(p)
}
