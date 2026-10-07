import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { SWEEP_THRESHOLD, edgeSpeed, sameHits, type Band, type SweepBox } from '../lib/marquee'

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
 */
export interface SweepOptions {
  /** The scrolling box. Its edges are where auto-scroll starts. */
  scroller: () => HTMLElement | null
  /** A pointer position in the list's own coordinates (y from row 0's top). */
  toList: (clientX: number, clientY: number) => { x: number; y: number }
  /** The rows the rectangle touches, across AND down (#326: `rowsInBox`), in
   *  list order, plus the one the pointer is nearest (where the keyboard
   *  carries on from). */
  hitsIn: (box: SweepBox, pointerY: number) => { paths: string[]; near: string | null }
  /** Scroll the list by this many screen pixels. */
  scrollBy: (dy: number) => void
  /** The sweep's covered rows, live, as it grows and shrinks. */
  onChange: (paths: string[]) => void
  /** Released with the rectangle up: the sweep's result stands. */
  onEnd: (paths: string[], near: string | null) => void
  /** Escape: put back what was marked before the press. */
  onCancel: () => void
}

export function useSweep(options: SweepOptions): {
  band: Band | null
  begin: (e: ReactPointerEvent, row?: HTMLElement | null) => void
} {
  const opts = useRef(options)
  useEffect(() => {
    opts.current = options
  })
  const [band, setBand] = useState<Band | null>(null)
  const stop = useRef<(() => void) | null>(null)
  useEffect(() => () => stop.current?.(), [])

  const begin = useCallback((e: ReactPointerEvent, row?: HTMLElement | null): void => {
    // A finger pans the list; only a mouse or a pen sweeps.
    if (e.button !== 0 || !e.isPrimary || e.pointerType === 'touch') return
    stop.current?.()
    const pointerId = e.pointerId
    const sx = e.clientX
    const sy = e.clientY
    const start = opts.current.toList(sx, sy)
    let last = { x: sx, y: sy }
    let started = false
    let cancelled = false
    let hits: string[] = []
    let near: string | null = null
    let frame = 0
    const wasDraggable = row?.draggable ?? false
    if (row) row.draggable = false
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const update = (): void => {
      const o = opts.current
      const at = o.toList(last.x, last.y)
      setBand({ x0: start.x, y0: start.y, x1: at.x, y1: at.y })
      const next = o.hitsIn(
        {
          left: Math.min(start.x, at.x),
          right: Math.max(start.x, at.x),
          top: Math.min(start.y, at.y),
          bottom: Math.max(start.y, at.y)
        },
        at.y
      )
      near = next.near
      if (!sameHits(hits, next.paths)) {
        hits = next.paths
        o.onChange(hits)
      }
    }
    // Auto-scroll: while the pointer sits near an edge of the list, move the
    // list and grow the rectangle with it. The pointer is the user's own hand,
    // so it runs under reduced motion too, at half the speed.
    const tick = (): void => {
      frame = 0
      const box = opts.current.scroller()
      if (!box || !started || cancelled) return
      const r = box.getBoundingClientRect()
      const dy = edgeSpeed(last.y, r.top, r.bottom, 36, still ? 11 : 22)
      if (dy) {
        const before = box.scrollTop
        opts.current.scrollBy(dy)
        if (box.scrollTop !== before) update()
      }
      frame = requestAnimationFrame(tick)
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
    const cleanup = (): void => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', abort, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', abort)
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      if (row) row.draggable = wasDraggable
      const box = opts.current.scroller()
      if (box?.hasPointerCapture?.(pointerId)) box.releasePointerCapture(pointerId)
      box?.removeAttribute('data-sweeping')
      setBand(null)
      stop.current = null
    }
    const finish = (): void => {
      const wasSweep = started && !cancelled
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
        const box = opts.current.scroller()
        box?.setAttribute('data-sweeping', '')
        // Captured only now: a capture from the press would retarget the click
        // of a plain press, and that click is today's behaviour.
        try {
          box?.setPointerCapture(pointerId)
        } catch {
          /* the pointer already went; the window listeners still hear it */
        }
        window.getSelection()?.removeAllRanges()
        frame = requestAnimationFrame(tick)
      }
      update()
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
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      setBand(null)
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

  return { band, begin }
}
