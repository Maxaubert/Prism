import { dirname, extname, isAbsolute, resolve } from 'path'
import { exists } from './fsUtil'

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
/** A `<picture>`'s `<source srcset>` (and an `<img srcset>`): one URL per
 *  comma-separated candidate, before its width or density (2026-10-14: the
 *  README's AVIF sat in a `<source>`, and only the phone's old root wall had
 *  served it). */
const SRCSET = /<(?:source|img)\b[^>]*?\bsrcset\s*=\s*["']([^"']+)["']/gi

/** Every reference the text makes, in its order: a srcset gives one per
 *  candidate. */
function references(text: string): string[] {
  const out: string[] = []
  for (const re of [MD_IMAGE, HTML_IMAGE, SRCSET]) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      if (re === SRCSET) for (const c of m[1].split(',')) out.push(c.trim().split(/\s+/)[0] ?? '')
      else out.push(m[1])
    }
  }
  return out
}

/**
 * Everything the text points at that is a local image file which exists.
 *
 * Async (owner, 2026-10-12, main never waits on the disk): the existence
 * checks were a stat each on main's thread for every markdown file opened.
 * They are asked a batch at a time, in the text's order, so the answer and
 * its cap are the same as one stat at a time.
 */
export async function documentImages(docPath: string, text: string): Promise<string[]> {
  const out: string[] = []
  const wanted = imageCandidates(docPath, text)
  for (let i = 0; i < wanted.length && out.length < MAX_GRANTS; i += MAX_GRANTS) {
    const batch = wanted.slice(i, i + MAX_GRANTS)
    const there = await Promise.all(batch.map(exists))
    for (let j = 0; j < batch.length && out.length < MAX_GRANTS; j++) if (there[j]) out.push(batch[j])
  }
  return out
}

/** The local image files the text names, deduplicated, in order, unchecked. */
function imageCandidates(docPath: string, text: string): string[] {
  const dir = dirname(docPath)
  const out: string[] = []
  const seen = new Set<string>()
  {
    for (const ref of references(text)) {
      const raw = ref.trim()
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
      // Relative only. An absolute path in a document is not a reference to
      // something beside it, and granting one would let any markdown file open
      // a picture anywhere on the disk for the rest of the session.
      if (isAbsolute(rel) || /^[a-z]:/i.test(rel)) continue
      const full = resolve(dir, rel)
      const key = full.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      if (!IMAGE_EXTS.has(extname(full).toLowerCase())) continue
      out.push(full)
    }
  }
  return out
}
