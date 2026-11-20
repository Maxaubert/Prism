/**
 * Whether a dropdown list opens ABOVE its button (audit #85). The list is absolute under the button, inside the
 * settings pane that scrolls and clips it, so a Select near the pane's bottom opened into the clip and its last
 * options could not be reached. It flips up when it does not fit below and there is more room above. `bounds` is
 * the visible box the list must stay inside (the pane's, within the window's).
 */
export function opensAbove(
  button: { top: number; bottom: number },
  listHeight: number,
  bounds: { top: number; bottom: number },
  gap = 4
): boolean {
  const below = bounds.bottom - button.bottom - gap
  const above = button.top - bounds.top - gap
  return listHeight > below && above > below
}