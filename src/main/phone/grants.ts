/**
 * Per-phone grants (2026-09-06, #106): the files an ANSWER produced that the
 * phone that asked may now fetch through the media route. A markdown's own
 * pictures may live outside the folder the phone paired to, a comic's pages
 * are unpacked under userData, an extracted archive member lands in temp: the
 * root wall refuses every one of them, and this is the wall's only softening
 * on the phone path. Each grant belongs to ONE token, so a picture one phone's
 * README named is still 403 to every other phone, and `drop` on forget takes
 * the lot with it.
 *
 * Pure: no fs. Keys are resolved and lowercased, since Windows paths are
 * case-insensitive and a climb (`..`) has to land where it lands, not where
 * it is spelled.
 */
import { isAbsolute, relative, resolve, sep } from 'path'

const key = (p: string): string => resolve(p).toLowerCase()

export class Grants {
  /** token -> exact files */
  private files = new Map<string, Set<string>>()
  /** token -> directories, everything under them */
  private dirs = new Map<string, Set<string>>()

  grant(token: string, path: string): void {
    let set = this.files.get(token)
    if (!set) this.files.set(token, (set = new Set()))
    set.add(key(path))
  }

  /** Everything under `dir`, for a comic's page directory: a 200-page book
   *  would otherwise be 200 entries kept in step with an eviction. */
  grantDir(token: string, dir: string): void {
    let set = this.dirs.get(token)
    if (!set) this.dirs.set(token, (set = new Set()))
    set.add(key(dir))
  }

  has(token: string, path: string): boolean {
    const k = key(path)
    if (this.files.get(token)?.has(k)) return true
    const dirs = this.dirs.get(token)
    if (!dirs) return false
    for (const d of dirs) if (underDir(d, k)) return true
    return false
  }

  drop(token: string): void {
    this.files.delete(token)
    this.dirs.delete(token)
  }
}

/** `p` is strictly under `dir`: the relative path is non-empty, does not
 *  climb and is not absolute (a different drive), both already resolved. */
function underDir(dir: string, p: string): boolean {
  const rel = relative(dir, p)
  return !!rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}
