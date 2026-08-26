// The selection model, pure. Shared by the sidebar tree, the archive view and
// the search results: each hands in its visible order and gets the next
// selection back. Shift ranges and ctrl toggles - drag-to-select was tried
// and REMOVED (owner, 2026-08-22): its pointer state outlived real drags and
// a dropped folder would start a phantom sweep with no button held.

export interface Selection {
  /** Where a shift-range or sweep grows from: the last plain-clicked row. */
  anchor: string | null
  items: ReadonlySet<string>
}

export const emptySelection: Selection = { anchor: null, items: new Set() }

const rangeOf = (order: readonly string[], a: string, b: string): string[] => {
  const i = order.indexOf(a)
  const j = order.indexOf(b)
  if (i < 0 || j < 0) return [b]
  const [lo, hi] = i <= j ? [i, j] : [j, i]
  return order.slice(lo, hi + 1)
}

/** One click lands on `path`: plain replaces, ctrl toggles, shift ranges from
 *  the anchor over `order` (the rows as currently visible, top to bottom). */
export function clickSelect(
  order: readonly string[],
  sel: Selection,
  path: string,
  mods: { shift?: boolean; ctrl?: boolean }
): Selection {
  if (mods.shift) {
    // The range MERGES with what is already marked (owner call 2026-08-22,
    // deliberately not Explorer's replace): file 1 marked, then a shifted
    // 4-to-2 keeps 1. A plain click is the way back to one.
    // An anchor that has left the visible rows (its folder collapsed, the file
    // was deleted) would range from nowhere, so the click re-anchors instead.
    const anchor = sel.anchor && order.includes(sel.anchor) ? sel.anchor : path
    return { anchor, items: new Set([...sel.items, ...rangeOf(order, anchor, path)]) }
  }
  if (mods.ctrl) {
    const items = new Set(sel.items)
    if (items.has(path)) items.delete(path)
    else items.add(path)
    return { anchor: path, items }
  }
  return { anchor: path, items: new Set([path]) }
}

