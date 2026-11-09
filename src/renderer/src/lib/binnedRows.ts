import { pathKey } from '@shared/path'

/**
 * THE ROW AFTER A DELETE (owner, 2026-11-09: "it deltes tehn selects the next
 * file by dfeault which is good"). The list has the order, the delete has the
 * paths: whoever binned them notes them here, and the list showing them hands
 * the selection to the row beside the one that went. Only a delete notes, so a
 * rename (the old path also leaves the listing) is not mistaken for one.
 */
let binned: ReadonlySet<string> = new Set()

export function noteBinned(paths: readonly string[]): void {
  binned = new Set(paths.map(pathKey))
}

export function wasBinned(path: string): boolean {
  return binned.has(pathKey(path))
}

/**
 * The row that takes over from `gone`, as `rows` stood before it went: the
 * first still there after it, else the nearest still there before it (the
 * last row went, so the selection moves up). Null when nothing is left.
 */
export function rowAfter(
  rows: readonly string[],
  gone: string,
  stillThere: (path: string) => boolean
): string | null {
  const at = rows.indexOf(gone)
  if (at < 0) return null
  for (let i = at + 1; i < rows.length; i += 1) if (stillThere(rows[i])) return rows[i]
  for (let i = at - 1; i >= 0; i -= 1) if (stillThere(rows[i])) return rows[i]
  return null
}
