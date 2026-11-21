/**
 * How big the player's cog menu may be (audit #94). It hangs above its button, right edges together, 230 px wide
 * and up to 420 tall, inside a viewer box that clips it. The Explorer's preview pane can be as narrow as a third of
 * the window, so the menu lost its left side and its top. The limits are the room between the button and the
 * visible box's edge, less a margin, never above the menu's own size and never below a size that is still readable
 * (past that the menu is allowed to clip rather than collapse).
 */
export function menuLimits(
  button: { top: number; right: number },
  bounds: { top: number; left: number },
  viewHeight: number,
  natural = { width: 230, height: 420 },
  margin = 8
): { maxWidth: number; maxHeight: number } {
  const room = (v: number, max: number, min: number): number => Math.max(min, Math.min(max, v))
  return {
    maxWidth: room(button.right - bounds.left - margin, natural.width, 150),
    maxHeight: room(Math.min(button.top - bounds.top - margin - 36, viewHeight * 0.6), natural.height, 96)
  }
}