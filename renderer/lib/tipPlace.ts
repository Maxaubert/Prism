/**
 * WHERE A TOOLTIP GOES (owner, 2026-10-13: "make the tooltips appear at the
 * right place ... when i hover over settings or command help they dont appear
 * under it centered, they appear from bottom right of that item ... some
 * places it should probably be positioned differently than just under, but
 * just as a general rule for icons and so on"). Windows draws a `title` at the
 * pointer, below and right of it; the app's own tip is placed by the ITEM:
 * centred under it, above it when there is no room below, or beside it where
 * the item asks (`data-tip-side`, the vertical tab sidebar's rows), always
 * inside the window. Pure, so the rule has tests.
 */

export type TipSide = 'below' | 'above' | 'right' | 'left'

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

export interface TipSpot {
  x: number
  y: number
  /** Where it ended up, after any flip: the tip's entrance leans from it. */
  side: TipSide
}

/** The gap between the item and its tip, and the tip's distance from the
 *  window's edge. */
export const TIP_GAP = 6
export const TIP_MARGIN = 6

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

export function placeTip(
  item: Box,
  tip: { width: number; height: number },
  view: { width: number; height: number },
  prefer: TipSide = 'below'
): TipSpot {
  const fitsBelow = item.top + item.height + TIP_GAP + tip.height <= view.height - TIP_MARGIN
  const fitsAbove = item.top - TIP_GAP - tip.height >= TIP_MARGIN
  const fitsRight = item.left + item.width + TIP_GAP + tip.width <= view.width - TIP_MARGIN
  const fitsLeft = item.left - TIP_GAP - tip.width >= TIP_MARGIN
  let side: TipSide = prefer
  if (prefer === 'below' && !fitsBelow && fitsAbove) side = 'above'
  else if (prefer === 'above' && !fitsAbove && fitsBelow) side = 'below'
  else if (prefer === 'right' && !fitsRight) side = fitsLeft ? 'left' : 'below'
  else if (prefer === 'left' && !fitsLeft) side = fitsRight ? 'right' : 'below'
  const maxX = view.width - TIP_MARGIN - tip.width
  const maxY = view.height - TIP_MARGIN - tip.height
  if (side === 'below' || side === 'above') {
    const x = clamp(item.left + item.width / 2 - tip.width / 2, TIP_MARGIN, Math.max(TIP_MARGIN, maxX))
    const y = side === 'below' ? item.top + item.height + TIP_GAP : item.top - TIP_GAP - tip.height
    return { x: Math.round(x), y: Math.round(clamp(y, TIP_MARGIN, Math.max(TIP_MARGIN, maxY))), side }
  }
  const x = side === 'right' ? item.left + item.width + TIP_GAP : item.left - TIP_GAP - tip.width
  const y = clamp(item.top + item.height / 2 - tip.height / 2, TIP_MARGIN, Math.max(TIP_MARGIN, maxY))
  return { x: Math.round(clamp(x, TIP_MARGIN, Math.max(TIP_MARGIN, maxX))), y: Math.round(y), side }
}
