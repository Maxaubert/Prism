import type { ArchiveEntry } from './types'

/**
 * The folders an archive implies but does not record (2026-08-31).
 *
 * A zip is a flat list of members, and the directory entries are OPTIONAL.
 * Most writers include them; plenty do not - Google Takeout is the one that
 * found this, and `zip -D`, many Java tools and a lot of web exporters do the
 * same. Such an archive has members called `Collection/Art/cover.cbz` and no
 * entry for `Collection` or `Collection/Art` anywhere in it.
 *
 * The panel lists one level at a time by matching each entry's parent against
 * the folder you are in, so an archive like that showed NOTHING at its root:
 * every member's parent was two levels down, and the folders those names
 * imply did not exist to be listed. An archive that plainly is not empty
 * reading as empty is about the worst answer available.
 *
 * So the missing folders are filled in from the member names. Pure, and
 * applied to BOTH readers' output rather than to one of them: adm-zip and
 * 7-Zip report what the container says, and what the container says is the
 * problem.
 */
export function withImpliedFolders(entries: readonly ArchiveEntry[]): ArchiveEntry[] {
  const seen = new Set<string>()
  for (const e of entries) seen.add(e.path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase())

  const added: ArchiveEntry[] = []
  for (const e of entries) {
    const norm = e.path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    const parts = norm.split('/')
    // Every ancestor, not just the immediate parent: a member three levels
    // down implies all three, and stopping at one leaves the same hole a
    // level up.
    for (let i = 1; i < parts.length; i += 1) {
      const dir = parts.slice(0, i).join('/')
      const key = dir.toLowerCase()
      if (!dir || seen.has(key)) continue
      seen.add(key)
      added.push({ path: dir, name: parts[i - 1], dir: true, size: 0 })
    }
  }
  return added.length ? [...entries, ...added] : [...entries]
}
