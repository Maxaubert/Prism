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

/** One axis's bar: the track's box on screen (fixed) and its thumb. */
export interface Bar {
  axis: Axis
  left: number
  top: number
  length: number
  thumb: Thumb
}

/** Does an `overflow-x`/`overflow-y` value let the user scroll that way? A
 *  hidden axis can still be scrolled by code (scrollIntoView), and it got a
 *  visible, draggable bar that shifted the content sideways (review,
 *  2026-10-28). */
export function scrollsByStyle(overflow: string): boolean {
  return overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay'
}

/** The same tracks, thumb sizes included: only the thumbs' offsets may differ,
 *  which the component writes straight to the thumb instead of rendering. */
export function sameTracks(a: readonly Bar[], b: readonly Bar[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (x, i) =>
        x.axis === b[i].axis &&
        x.left === b[i].left &&
        x.top === b[i].top &&
        x.length === b[i].length &&
        x.thumb.size === b[i].thumb.size
    )
  )
}

/** A press on an overlay bar. Outside-press closers (menus, popovers) let it
 *  be: the bar is portaled outside their box, so pressing the thumb of a
 *  scrolled menu closed the menu under it (review, 2026-10-28). */
export function onOverlayScrollbar(target: EventTarget | Node | null): boolean {
  const el = target as { closest?: (selector: string) => unknown } | null
  return typeof el?.closest === 'function' && !!el.closest('[data-overlay-scrollbar]')
}
