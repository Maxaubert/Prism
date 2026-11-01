import type { SaveCopiesResult } from '@shared/ipcTypes'

/**
 * What Save copies as says on the chip when it is over (#474; owner,
 * 2026-11-01: a copy that fails is reported, "Saved 37 copies, 2 could not
 * be read"). Rows that were not pictures are said too, and a Cancel says it
 * stopped and what it had saved by then.
 */
export function copiesNote(r: SaveCopiesResult): string {
  const n = r.saved.length
  const saved = n === 0 ? 'no copies saved' : `saved ${n} ${n === 1 ? 'copy' : 'copies'}`
  const parts = [
    ...(r.failed ? [`${r.failed} could not be read`] : []),
    ...(r.skipped ? [`${r.skipped} skipped (not pictures)`] : [])
  ]
  const head = r.canceled ? `Stopped, ${saved}` : saved[0].toUpperCase() + saved.slice(1)
  return [head, ...parts].join(', ')
}
