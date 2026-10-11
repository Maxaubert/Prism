/**
 * THE SIZE PRISM OPENS AT (owner, 2026-10-11: "i dont love that it opens fullscreen, it
 * should be the same size as file explorer"; asked, the owner chose "Explorer size,
 * remember resizes"). Pure, so the rules are tested without a screen.
 *
 * - Nothing saved: File Explorer's own size, MEASURED on the owner's machine the same day
 *   (a fresh File Explorer window, 933 x 756 DIP, windowed), centred by Electron and held
 *   to 90% of a small screen. It was 1164 x 698 (2026-10-04).
 * - A size the user dragged to comes back, and its place while a display still holds it.
 * - NEVER MAXIMIZED: the saved flag is ignored. And a saved size that fills its screen
 *   counts as no size, since un-maximizing to the whole work area is the same complaint
 *   (the owner's saved size was 1711 x 914 on a 1707 x 912 work area).
 */
export interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export const FIRST_WINDOW = { width: 933, height: 756 }
export const MIN_WINDOW = { width: 560, height: 400 }
/** A saved size at least this share of the work area both ways "fills the screen". */
const FILLS = 0.95

export function firstWindow(area: { width: number; height: number }): WindowState {
  return {
    width: Math.max(MIN_WINDOW.width, Math.min(FIRST_WINDOW.width, Math.round(area.width * 0.9))),
    height: Math.max(MIN_WINDOW.height, Math.min(FIRST_WINDOW.height, Math.round(area.height * 0.9)))
  }
}

export function restoredWindow(
  saved: unknown,
  displays: ReadonlyArray<{ workArea: Rect }>,
  primary: Rect
): WindowState {
  const fallback = firstWindow(primary)
  const s = saved as Partial<Record<'width' | 'height' | 'x' | 'y', unknown>> | null
  if (!s || typeof s !== 'object' || !Number.isFinite(s.width) || !Number.isFinite(s.height)) return fallback
  const size = {
    width: Math.max(MIN_WINDOW.width, Math.round(s.width as number)),
    height: Math.max(MIN_WINDOW.height, Math.round(s.height as number))
  }
  const placed = Number.isFinite(s.x) && Number.isFinite(s.y)
  const x = Math.round(s.x as number)
  const y = Math.round(s.y as number)
  // Only keep the position if some display still contains it: a window remembered on a
  // monitor that has since been unplugged opens off-screen.
  const home = placed
    ? displays.find(({ workArea: a }) => x + size.width > a.x && x < a.x + a.width && y + size.height > a.y && y < a.y + a.height)
    : undefined
  const area = home?.workArea ?? primary
  if (size.width >= area.width * FILLS && size.height >= area.height * FILLS) return fallback
  return home ? { ...size, x, y } : size
}
