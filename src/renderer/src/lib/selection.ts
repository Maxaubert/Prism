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
    const anchor = sel.anchor ?? path
    return { anchor, items: new Set(rangeOf(order, anchor, path)) }
  }
  if (mods.ctrl) {
    const items = new Set(sel.items)
    if (items.has(path)) items.delete(path)
    else items.add(path)
    return { anchor: path, items }
  }
  return { anchor: path, items: new Set([path]) }
}

/** Dragging across rows: the swept range, anchor to wherever the pointer is. */
export function sweepSelect(order: readonly string[], anchor: string, path: string): Selection {
  return { anchor, items: new Set(rangeOf(order, anchor, path)) }
}
