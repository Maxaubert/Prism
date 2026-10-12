/**
 * Where the drag label sits while a file is carried (#310; owner, 2026-10-07:
 * "it should be attached and it should be from the bottom right").
 *
 * The label is an in-page element placed in CSS pixels from the pointer's
 * client coordinates, so the display scale does not enter into it: the same
 * numbers hold at 100%, 150% and 225%. Its top-left corner hangs a small gap
 * below and right of the cursor's tip, as File Explorer's does, so the pointer
 * never covers the name. Only where the window's edge leaves no room does it
 * flip to the other side of the pointer, never sliding under it.
 */
export const DRAG_BADGE_GAP = 8
/** How far the label keeps from the window's edges. */
export const DRAG_BADGE_MARGIN = 4

export function dragBadgePlace(
  x: number,
  y: number,
  width: number,
  height: number,
  viewWidth: number,
  viewHeight: number
): { left: number; top: number } {
  const side = (at: number, size: number, view: number): number => {
    const after = at + DRAG_BADGE_GAP
    if (after + size <= view - DRAG_BADGE_MARGIN) return after
    const before = at - DRAG_BADGE_GAP - size
    if (before >= DRAG_BADGE_MARGIN) return before
    // No room on either side (a label wider than half the window): keep it
    // inside the window, which is all that is left to promise.
    return Math.max(DRAG_BADGE_MARGIN, view - DRAG_BADGE_MARGIN - size)
  }
  return { left: side(x, width, viewWidth), top: side(y, height, viewHeight) }
}
