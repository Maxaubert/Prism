/**
 * What the tree does with entries an action just created or moved
 * (2026-09-05, #101). Explorer's rule, as the owner put it: they are marked,
 * the cursor lands on the first, and exactly ONE FILE is also shown in the
 * viewer; a folder, or several of anything, is a ctrl-click selection and
 * nothing opens.
 *
 * The tree may not have listed the entries yet when the action reports them
 * (an extraction's folder arrives through the disk watcher a beat later), so
 * the plan says whether it is SETTLED: every path's kind is known, so the
 * open-or-mark decision can be made. Until then the caller marks by path and
 * asks again when the rows appear. Pure.
 */

export type EntryKind = 'file' | 'folder'

export interface LandingPlan {
  /** Every landed path, marked. */
  select: string[]
  /** Where the cursor goes: the first. */
  cursor: string | null
  /** The one file to show, or null when nothing opens. */
  open: string | null
  /** True once every path's kind is known. */
  settled: boolean
}

export function planLanding(
  paths: readonly string[],
  kindOf: (path: string) => EntryKind | undefined
): LandingPlan {
  const select = paths.filter(Boolean)
  if (!select.length) return { select, cursor: null, open: null, settled: true }
  const kinds = select.map(kindOf)
  const settled = kinds.every((k) => k !== undefined)
  const open = settled && select.length === 1 && kinds[0] === 'file' ? select[0] : null
  return { select, cursor: select[0], open, settled }
}
