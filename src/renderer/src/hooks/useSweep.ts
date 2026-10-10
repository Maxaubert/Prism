import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { flushSync } from 'react-dom'
import {
  SWEEP_THRESHOLD,
  bandBox,
  edgeSpeed,
  sameHits,
  type Band,
  type SweepBox
} from '../lib/marquee'
import type { CssRect, UpdateCause } from '@shared/sweepOverlay'
import { cssColour } from '../lib/cssColour'
import { nativeBox, onNativeBoxChange, sweepBridge } from './sweepOverlayState'

/**
 * THE SWEEP RECTANGLE (#257; owner, 2026-10-03: "let me highlight files by
 * holding down left click ... that transparent quadrant ... the one you see on
 * desktop"). One hook for the Explorer's list and the project tree; each hands
 * in how its own coordinates work.
 *
 * The tree had a sweep once and lost it the same day (2026-08-22): its pointer
 * state outlived real drags, so a dropped folder started a band with no button
 * held. This one cannot do that, for the archive panel's reasons and two more:
 * - it begins ONLY from a real left press (`begin`, from a pointerdown), never
 *   from a drag or a drop, which fire no pointerdown at all;
 * - every listener is on `window` and goes on pointerup, pointercancel, a lost
 *   window focus, Escape, or ANY move that arrives with the left button up
 *   (a cancel, a lost focus and Escape put back what was marked before);
 * - a press on a row's own icon or name never reaches here, so dragging a file
 *   out still drags the file. On a row's blank space the row's `draggable` is
 *   switched off for the length of the press, or Chromium would start an HTML5
 *   drag four pixels in and the pointer would be the drag's, not ours.
 *
 * THE BOX IS WHERE THE POINTER IS, IN THE FRAME THE MOVE LANDS IN (#332;
 * owner, 2026-10-08: "fast movements make it fall behind the cursor, while it
 * should stay at the cursor position perfectly the whole time, file explorer's
 * highlight does it perfectly"). The box was React state: every pointermove
 * set it, and React rendered the whole list after the frame was painted, so
 * every frame showed the box where the pointer had been one move before.
 * MEASURED (`sweepLag` e2e): in a fast sweep every move painted a frame up to
 * 54 px short, and while the list auto-scrolled every frame was off, by up to
 * 430 px. So the box is ONE element React only mounts and unmounts
 * (`sweeping`, `bandRef`); the pointer handler writes its place directly,
 * from geometry measured once (`measure`, again only after the list
 * scrolled or resized, and at the release), with no layout read on the way.
 * The band is mounted synchronously (`flushSync`) by the move that starts the
 * sweep, since a render scheduled from a native listener can land after that
 * frame is painted and show it with no box at all. What the box marks is worked out
 * at most once a frame, in the frame's own callback, from the latest
 * position, and once more on the release, so the marks that stand are exactly
 * the box's. `pointerrawupdate` was weighed and left out: pointermove is
 * already delivered just before the frame is drawn, with the newest position
 * the frame can show, and the raw event is for secure origins only.
 *
 * ON WINDOWS 11 THE BOX IS DRAWN NATIVELY (#338; owner, 2026-10-09). The rest
 * of the trail was Chromium's own path, so a MOUSE sweep hands its box to main
 * (`sweepOverlay`: the anchor, the clip and the band's own colours, at the
 * start and when the list scrolls or resizes, never per move), which draws it
 * with DirectComposition from the real cursor every compositor frame. The
 * band stays mounted and placed; it is only kept `display: none` while main
 * has said the box is native (`nativeBox`), so the fallback is a flag, not a
 * code path. Hit testing, the marks, auto-scroll and Escape stay here.
 */
let sweepIds = 0
export interface RowAcross {
  left: number
  right: number
}

export interface SweepOptions<G> {
  /** The scrolling box. Its edges are where auto-scroll starts. */
  scroller: () => HTMLElement | null
  /** Everything the sweep needs from the layout (rects, scroll offsets), read
   *  at the start and again only after the list scrolled, so a pointer move
   *  never waits on a layout. Null while there is nothing to measure. */
  measure: () => G | null
  /** A pointer position in the list's own coordinates (y from row 0's top),
   *  from the measured geometry alone. */
  toList: (clientX: number, clientY: number, geo: G) => { x: number; y: number }
  /** The list's own coordinates back to the page's client, with the measured
   *  scroll: `toList`'s inverse, for the native box's anchor (#338). */
  fromList: (p: { x: number; y: number }, geo: G) => { x: number; y: number }
  /** The scroller's visible rect in the page's client, from the measured
   *  geometry: what the native box is clipped to. */
  clipOf: (geo: G) => CssRect
  /** The box, from the list's coordinates into the band element's own
   *  container's, or null to leave it as it is. */
  place?: (band: Band, geo: G) => Band
  /** The rows the rectangle touches, across AND down (#326: `rowsInBox`), in
   *  list order, plus the one the pointer is nearest (where the keyboard
   *  carries on from). */
  hitsIn: (
    box: SweepBox,
    pointerY: number,
    across: RowAcross | null
  ) => { paths: string[]; near: string | null }
  /** Where a drawn row runs across, in the list's own x, or null while no row
   *  is drawn. Measured once per sweep (a row cannot change width under a
   *  held button), not on every tick, which would force a layout read each
   *  frame; asked again only while it is still null. */
  rowAcross: () => RowAcross | null
  /** Scroll the list by this many screen pixels. */
  scrollBy: (dy: number) => void
  /** The sweep's covered rows, live, as it grows and shrinks. */
  onChange: (paths: string[]) => void
  /** Released with the rectangle up: the sweep's result stands. */
  onEnd: (paths: string[], near: string | null) => void
  /** Escape: put back what was marked before the press. */
  onCancel: () => void
}

export function useSweep<G>(options: SweepOptions<G>): {
  /** A sweep is drawing: mount the band element and hand it `bandRef`. */
  sweeping: boolean
  bandRef: (el: HTMLElement | null) => void
  begin: (e: ReactPointerEvent, row?: HTMLElement | null) => void
} {
  const opts = useRef(options)
  useEffect(() => {
    opts.current = options
  })
  const [sweeping, setSweeping] = useState(false)
  const stop = useRef<(() => void) | null>(null)
  const band = useRef<HTMLElement | null>(null)
  /** Draws the running sweep's box, as it is now. */
  const draw = useRef<(() => void) | null>(null)
  useEffect(() => () => stop.current?.(), [])
  const bandRef = useCallback((el: HTMLElement | null): void => {
    band.current = el
    // Mounted a frame after the sweep began: placed in the commit that adds
    // it, so its first painted frame already has it under the pointer.
    if (el) draw.current?.()
  }, [])

  const begin = useCallback((e: ReactPointerEvent, row?: HTMLElement | null): void => {
    // A finger pans the list; only a mouse or a pen sweeps.
    if (e.button !== 0 || !e.isPrimary || e.pointerType === 'touch') return
    stop.current?.()
    const pointerId = e.pointerId
    const sx = e.clientX
    const sy = e.clientY
    let geo = opts.current.measure()
    const start = geo ? opts.current.toList(sx, sy, geo) : { x: 0, y: 0 }
    let last = { x: sx, y: sy }
    let started = false
    let cancelled = false
    let hits: string[] = []
    let near: string | null = null
    let frame = 0
    // The pointer moved (or the list scrolled) since the marks were worked out.
    let dirty = false
    let across: RowAcross | null = null
    let box: HTMLElement | null = null
    let resized: ResizeObserver | null = null
    const wasDraggable = row?.draggable ?? false
    if (row) row.draggable = false
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // Only a MOUSE sweep is handed to the native box: a pen's moves are not
    // promoted to mouse messages, so the native side's button check would hide
    // the box at once, and the cursor need not follow the pen tip (#338).
    const overlay = e.pointerType === 'mouse' ? sweepBridge() : null
    /** The id the native box knows this sweep by, while main has it. */
    let sent: number | null = null
    let sentKey = ''
    /** Main had said `native` when the begin went: only then can it have
     *  taken this sweep. A `true` that arrives mid-sweep (the target became
     *  ready, a Remote Desktop session ended) found no box to draw, since
     *  main ignored the begin, so the DOM box stays. */
    let nativeAtBegin = false
    let unwatch: (() => void) | null = null
    const overlayMsg = (): { anchor: { x: number; y: number }; clip: CssRect; dpr: number } | null =>
      geo
        ? { anchor: opts.current.fromList(start, geo), clip: opts.current.clipOf(geo), dpr: window.devicePixelRatio }
        : null
    /** The DOM band hides only while main draws this sweep natively. */
    const drawnNatively = (): boolean => sent !== null && nativeAtBegin && nativeBox()

    /** The box, in the list's own coordinates. */
    const bandNow = (): Band | null => {
      if (!geo) return null
      const at = opts.current.toList(last.x, last.y, geo)
      return { x0: start.x, y0: start.y, x1: at.x, y1: at.y }
    }
    const paint = (): void => {
      const el = band.current
      const b = started && !cancelled ? bandNow() : null
      if (!el || !b || !geo) return
      const p = bandBox(opts.current.place ? opts.current.place(b, geo) : b)
      // Written straight onto the element: no render, no layout read. Placed
      // even while the native box draws, so a fall back shows it in place.
      el.style.display = drawnNatively() ? 'none' : 'block'
      el.style.left = `${p.left}px`
      el.style.top = `${p.top}px`
      el.style.width = `${p.width}px`
      el.style.height = `${p.height}px`
    }
    /** What the box marks, from the latest position. At most once a frame
     *  while it moves, and once more on the release. */
    const mark = (): void => {
      dirty = false
      const o = opts.current
      const at = geo ? o.toList(last.x, last.y, geo) : null
      if (!at) return
      across ??= o.rowAcross()
      const next = o.hitsIn(
        {
          left: Math.min(start.x, at.x),
          right: Math.max(start.x, at.x),
          top: Math.min(start.y, at.y),
          bottom: Math.max(start.y, at.y)
        },
        at.y,
        across
      )
      near = next.near
      if (!sameHits(hits, next.paths)) {
        hits = next.paths
        o.onChange(hits)
      }
    }
    const remeasure = (): void => {
      geo = opts.current.measure() ?? geo
    }
    // The list scrolled (a wheel under the held button, or our own scroll), or
    // its layout changed (rows added or removed by the watcher, a window or
    // pane resize): the box's far corner is still under the pointer, so it is
    // drawn again with the new offsets, in this frame (scroll events and
    // resize observations come before the frame is painted).
    // The native box hears the new anchor and clip, with who moved the list:
    // it applies each cause a measured number of frames late, so the anchored
    // edge stays on its row. Our own auto-scroll write says 'auto' first; the
    // scroll event that follows it carries the same place and is not sent.
    const scrolled = (cause: UpdateCause): void => {
      if (!started || cancelled) return
      remeasure()
      paint()
      dirty = true
      if (overlay && sent !== null) {
        const m = overlayMsg()
        const k = JSON.stringify(m)
        if (m && k !== sentKey) {
          sentKey = k
          overlay.update({ id: sent, cause, ...m })
        }
      }
    }
    const onScroll = (): void => scrolled('scroll')
    const onResize = (): void => scrolled('resize')
    // Every frame of the sweep: auto-scroll while the pointer sits near an
    // edge of the list (the pointer is the user's own hand, so it runs under
    // reduced motion too, at half the speed), then the marks, if anything
    // moved. Runs before the frame is drawn, so what it changes is in it.
    const tick = (): void => {
      frame = 0
      if (!started || cancelled) return
      const sc = opts.current.scroller()
      if (sc && geo) {
        const r = sc.getBoundingClientRect()
        const dy = edgeSpeed(last.y, r.top, r.bottom, 36, still ? 11 : 22)
        if (dy) {
          const before = sc.scrollTop
          opts.current.scrollBy(dy)
          if (sc.scrollTop !== before) scrolled('auto')
        }
      }
      if (dirty) mark()
      frame = requestAnimationFrame(tick)
    }
    /** The move that starts a mouse sweep hands its box to main (#338), in the
     *  band's own computed colours (one style read per sweep): the theme's,
     *  exactly. Main decides whether it is drawn natively. */
    const handOver = (): void => {
      const el = band.current
      if (!overlay || !el) return
      const cs = getComputedStyle(el)
      const fill = cssColour(cs.backgroundColor)
      const edge = cssColour(cs.borderTopColor)
      const m = overlayMsg()
      if (!fill || !edge || !m) return
      sent = ++sweepIds
      sentKey = JSON.stringify(m)
      nativeAtBegin = nativeBox()
      overlay.begin({ id: sent, ...m, fill, edge })
      // Main turning native off mid-sweep (a refused begin, a failure, a
      // Remote Desktop session) shows the DOM box in place at once, even
      // with the pointer held still.
      unwatch = onNativeBoxChange(paint)
    }
    const swallowClick = (): void => {
      // The release lands a click on whatever is under it (a row, or the list,
      // which would clear everything). The sweep was the act; that click is not.
      const eat = (ev: MouseEvent): void => {
        ev.stopPropagation()
        ev.preventDefault()
      }
      window.addEventListener('click', eat, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', eat, true), 0)
    }
    const hide = (): void => {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      // Gone in this frame, before React gets round to unmounting it.
      if (band.current) band.current.style.display = 'none'
      // And the native box: every path that hides the band ends it.
      if (overlay && sent !== null) overlay.end({ id: sent })
      sent = null
      unwatch?.()
      unwatch = null
      setSweeping(false)
    }
    const cleanup = (): void => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', abort, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', abort)
      box?.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      resized?.disconnect()
      resized = null
      if (row) row.draggable = wasDraggable
      if (box?.hasPointerCapture?.(pointerId)) box.releasePointerCapture(pointerId)
      box?.removeAttribute('data-sweeping')
      hide()
      draw.current = null
      stop.current = null
    }
    const finish = (): void => {
      const wasSweep = started && !cancelled
      // The marks that stand are the box's at the release, never a frame old:
      // measured again first, since a wheel turn just before the release has
      // moved the list but not yet sent its scroll event. One layout read.
      if (wasSweep) {
        remeasure()
        mark()
      }
      const result = hits
      const at = near
      cleanup()
      if (wasSweep) opts.current.onEnd(result, at)
    }
    const move = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return
      // A move with the button up is a press we never saw end: end it now.
      if (!(ev.buttons & 1)) return finish()
      last = { x: ev.clientX, y: ev.clientY }
      if (cancelled) return
      if (!started) {
        if (
          Math.abs(ev.clientX - sx) < SWEEP_THRESHOLD &&
          Math.abs(ev.clientY - sy) < SWEEP_THRESHOLD
        )
          return
        started = true
        // The list may have scrolled since the press (a wheel under the held
        // button): measured again, while `start` keeps the press's own place
        // in the list.
        remeasure()
        box = opts.current.scroller()
        box?.setAttribute('data-sweeping', '')
        box?.addEventListener('scroll', onScroll, { passive: true })
        window.addEventListener('resize', onResize)
        if (box && typeof ResizeObserver !== 'undefined') {
          // The box and what it holds (the list grows or shrinks as rows come
          // and go); never the band itself, which changes size on every move.
          resized = new ResizeObserver(onResize)
          resized.observe(box)
          for (const child of box.children)
            if (!child.hasAttribute('data-sweep-band')) resized.observe(child)
          const tree = box.querySelector('[role="tree"]')
          if (tree && tree.parentElement !== box) resized.observe(tree)
        }
        // Captured only now: a capture from the press would retarget the click
        // of a plain press, and that click is today's behaviour.
        try {
          box?.setPointerCapture(pointerId)
        } catch {
          /* the pointer already went; the window listeners still hear it */
        }
        window.getSelection()?.removeAllRanges()
        draw.current = paint
        // Synchronous, once per sweep: the band is in the DOM (and placed, by
        // `bandRef`) before this frame is painted.
        flushSync(() => setSweeping(true))
        handOver()
        frame = requestAnimationFrame(tick)
      }
      paint()
      dirty = true
    }
    const up = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return
      if (started) swallowClick()
      finish()
    }
    // A pointer the system took away (pointercancel) or a window that lost
    // focus mid-sweep is not a release: the user never let go on a result, so
    // the sweep is undone as Escape undoes it, not kept half made.
    const abort = (): void => {
      const undo = started && !cancelled
      cleanup()
      if (undo) opts.current.onCancel()
    }
    const key = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape' || !started || cancelled) return
      ev.preventDefault()
      ev.stopPropagation()
      cancelled = true
      hide()
      opts.current.onCancel()
      // Still listening for the release, so its click is eaten too.
    }
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', abort, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', abort)
    stop.current = cleanup
  }, [])

  return { sweeping, bandRef, begin }
}
