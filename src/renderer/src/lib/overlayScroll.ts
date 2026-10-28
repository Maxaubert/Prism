/** The overlay scrollbar's arithmetic (components/OverlayScrollbars.tsx), as
 *  the file list's own bar does it (browse/OverlayScrollbar.tsx). */

export type Axis = 'y' | 'x'

export interface ScrollMetrics {
  scrollTop: number
  scrollLeft: number
  scrollHeight: number
  scrollWidth: number
  clientHeight: number
  clientWidth: number
}

export interface Thumb {
  scrollable: boolean
  /** Offset of the thumb along the track, px. */
  start: number
  size: number
}

/** The thumb for one axis, as the file list's: at least 28 px, the track's
 *  share of the content, placed by how far it has scrolled. */
export function thumbFor(m: ScrollMetrics, axis: Axis): Thumb {
  const view = axis === 'y' ? m.clientHeight : m.clientWidth
  const full = axis === 'y' ? m.scrollHeight : m.scrollWidth
  const pos = axis === 'y' ? m.scrollTop : m.scrollLeft
  if (full <= view + 1 || view <= 0) return { scrollable: false, start: 0, size: 0 }
  const size = Math.max(28, (view * view) / full)
  const start = (pos / (full - view)) * (view - size)
  return { scrollable: true, start: Math.max(0, Math.min(view - size, start)), size }
}
