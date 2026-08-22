// Explorer's selection model, pure (owner decision 2026-08-22: single click
// SELECTS, double click opens - multi-select is the fresh decision CLAUDE.md
// reserved). Shared by the sidebar tree and the archive view: both hand in
// their visible order and get the next selection back.

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
    const anchor = sel.anchor ?? path
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

/** Dragging across rows: the swept range, anchor to wherever the pointer is,
 *  merged with whatever was selected when the sweep began (`base`) - so a
 *  second sweep grows the pile rather than replacing it. Recomputed from the
 *  base each move, so shrinking the sweep sheds only the sweep's own rows. */
export function sweepSelect(
  order: readonly string[],
  anchor: string,
  path: string,
  base: ReadonlySet<string> = new Set()
): Selection {
  return { anchor, items: new Set([...base, ...rangeOf(order, anchor, path)]) }
}
