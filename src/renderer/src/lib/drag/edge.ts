/**
 * WHEN A CARRIED DRAG HAS LEFT THE WINDOW (#103, D1). Chromium keeps sending
 * mouse moves while the button is held, even past the window's edge, so the
 * in-app carry sees the pointer go. The last EDGE_PX inside each edge count
 * as out too: a maximized window has no outside on the screen's own edges,
 * and the pointer stops at its last pixel there.
 */
export const EDGE_PX = 2

export function pointerOut(x: number, y: number, width: number, height: number, edge = EDGE_PX): boolean {
  if (!(width > 0 && height > 0)) return false
  return x < edge || y < edge || x >= width - edge || y >= height - edge
}
