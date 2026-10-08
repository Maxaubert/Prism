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
  clampToView,
  edgeSpeed,
  inSpan,
  sameSpan,
  snapBox,
  sweepMark,
  type ClientRect,
  type Point,
  type SweepBox,
  type SweepSpan
} from '../lib/marquee'

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
 * frame is painted and show it with no box at all. `pointerrawupdate` was
 * weighed and left out: pointermove is already delivered just before the
 * frame is drawn, with the newest position the frame can show, and the raw
 * event is for secure origins only.
 *
 * AND IT DOES NOT SHAKE (#332; owner, 2026-10-08, the box "shakes, as if it
 * keeps re-rendering"; research `research/prism/2026-10-08-explorer-marquee.md`).
 * The shake was uneven lag: the gap to the pointer changed size from frame to
 * frame. Explorer's `UIMarqueeSelector` does little, in one place, from one
 * position, in whole pixels, and so does this:
 * - THE MARKS ARE NOT REACT'S UNTIL THE RELEASE. A sweep that changed the hit
 *   set re-rendered the list (the tree: every row) in that frame, and a long
 *   render held the box a frame and then jumped it two. Now the hook writes
 *   `data-sweep-mark` (`on` or `off`) and `data-sweep-up` / `-down` on the rows
 *   in view (`rows`), which the stylesheets draw over React's own marks while
 *   the scroller carries `data-sweeping`, again after any render adds rows
 *   (a MutationObserver), and only when the covered run of rows changed. The
 *   selection goes to React ONCE, on the release, in the same task that takes
 *   the hook's marks away, so no frame shows either half alone. Escape, a
 *   cancel and a lost focus only take them away: React never changed.
 * - THE BOX IS OUT OF THE LIST. Inside the scroller every resize of the box
 *   re-rastered the rows under it. It is a clipped overlay over the scroller
 *   now (`SweepBand`), placed in screen pixels.
 * - ONE CORNER STAYS PUT. The press is kept in the list's own coordinates
 *   (`start`) and mapped to the screen on every move and every scroll, with the
 *   last pointer position, as Explorer's ScrollUpdateEvent does; both corners
 *   are snapped to whole device pixels (`snapBox`), so the anchored edge is the
 *   same pixel on every frame, and each is held to the list plus a pixel.
 * - ONE POSITION SOURCE. The box is painted in the pointermove from that
 *   event's own point, one write per event, never animated; auto-scroll reads
 *   the list's edges from the measured geometry, not a layout read per frame.
 */
export interface RowAcross {
  left: number
  right: number
}

/** A row drawn in the list, as the sweep marks it: its element, its index (the
 *  hit test's unit), its path (the selection's), and the neighbours a marked
 *  run joins across, by the host's own rule for its React marks. */
export interface SweepRow {
  el: HTMLElement
  index: number
  path: string
  up: { index: number; path: string } | null
  down: { index: number; path: string } | null
}

export interface SweepOptions<G> {
  /** The scrolling box. Its edges are where auto-scroll starts. */
  scroller: () => HTMLElement | null
  /** Everything the sweep needs from the layout (rects, scroll offsets), read
   *  at the start and again only after the list scrolled, so a pointer move
   *  never waits on a layout. Null while there is nothing to measure. */
  measure: () => G | null
  /** A pointer position in the list's own coordinates (y from row 0's top),
   *  from the measured geometry alone, clamped to the list's content. */
  toList: (clientX: number, clientY: number, geo: G) => Point
  /** And back: a point in the list's coordinates, on the screen now. */
  toClient: (p: Point, geo: G) => Point
  /** The rows the rectangle touches, across AND down (#326: `rowsInBox`), by
   *  index, plus the one the pointer is nearest (where the keyboard carries on
   *  from), or null. */
  span: (box: SweepBox, pointerY: number, across: RowAcross | null) => SweepSpan | null
  /** A span's rows as paths, and the nearest one's: asked once, at the release. */
  pathsIn: (span: SweepSpan) => { paths: string[]; near: string | null }
  /** The rows drawn now, to be marked. */
  rows: () => Iterable<SweepRow>
  /** Is this row marked by React now? Read while the sweep runs, when React's
   *  marks are still the ones from before it. */
  held: (path: string) => boolean
  /** Where a drawn row runs across, in the list's own x, or null while no row
   *  is drawn. Measured once per sweep (a row cannot change width under a
   *  held button), not on every tick, which would force a layout read each
   *  frame; asked again only while it is still null. */
  rowAcross: () => RowAcross | null
  /** Scroll the list by this many screen pixels. */
  scrollBy: (dy: number) => void
  /** Released with the rectangle up: the sweep's result stands. `add` is a
   *  Ctrl sweep, which keeps what was marked before it. Called inside
   *  `flushSync`, so what it sets is on screen in the release's own frame. */
  onEnd: (paths: string[], near: string | null, add: boolean) => void
  /** Escape, a cancel or a lost focus: put back what was marked before the
   *  press, if the press itself changed it. */
  onCancel: () => void
}

const MARK_ATTRS = ['data-sweep-mark', 'data-sweep-up', 'data-sweep-down'] as const

/** Set or remove an attribute, touching the element only when it changes. */
function attr(el: HTMLElement, name: string, value: string | null): void {
  if (el.getAttribute(name) === value) return
  if (value === null) el.removeAttribute(name)
  else el.setAttribute(name, value)
}

export function useSweep<G>(options: SweepOptions<G>): {
  /** A sweep is drawing: mount `SweepBand` and hand it `bandRef`. */
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
  /** The overlay's clip; the band is its one child. */
  const clip = useRef<HTMLElement | null>(null)
  /** Places the running sweep's overlay and draws the box, as it is now. */
  const draw = useRef<(() => void) | null>(null)
  useEffect(() => () => stop.current?.(), [])
  const bandRef = useCallback((el: HTMLElement | null): void => {
    clip.current = el
    // Mounted by the move that began the sweep: placed in the commit that
    // adds it, so its first painted frame already has it under the pointer.
    if (el) draw.current?.()
  }, [])

  const begin = useCallback((e: ReactPointerEvent, row?: HTMLElement | null): void => {
    // A finger pans the list; only a mouse or a pen sweeps.
    if (e.button !== 0 || !e.isPrimary || e.pointerType === 'touch') return
    stop.current?.()
    const pointerId = e.pointerId
    const sx = e.clientX
    const sy = e.clientY
    const add = e.ctrlKey
    let geo = opts.current.measure()
    // The press, in the list's own coordinates: it moves with the rows.
    const start = geo ? opts.current.toList(sx, sy, geo) : { x: 0, y: 0 }
    let last = { x: sx, y: sy }
    let started = false
    let cancelled = false
    let span: SweepSpan | null = null
    // The marks were painted at least once (until then React's stand alone).
    let marking = false
    let frame = 0
    // The pointer moved (or the list scrolled) since the marks were worked out.
    let dirty = false
    let across: { left: number; right: number } | null = null
    let box: HTMLElement | null = null
    let resized: ResizeObserver | null = null
    let added: MutationObserver | null = null
    /** The scroller's visible box on screen, and where the overlay's container
     *  starts: measured with the geometry, never per move. */
    let view: ClientRect | null = null
    let origin: Point | null = null
    const dpr = window.devicePixelRatio || 1
    const wasDraggable = row?.draggable ?? false
    if (row) row.draggable = false
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const remeasure = (): void => {
      geo = opts.current.measure() ?? geo
    }
    /** The scroller's box and the overlay's container. Only at the start and
     *  after a resize: a scroll moves neither. */
    const measureView = (): void => {
      const sc = box ?? opts.current.scroller()
      if (!sc) return
      const r = sc.getBoundingClientRect()
      const left = r.left + sc.clientLeft
      const top = r.top + sc.clientTop
      view = { left, top, right: left + sc.clientWidth, bottom: top + sc.clientHeight }
      const c = clip.current
      const host = c?.parentElement
      if (!c || !host) return
      const h = host.getBoundingClientRect()
      origin = { x: h.left + host.clientLeft, y: h.top + host.clientTop }
      // The clip is the scroller's visible box: the box is cut where the list is.
      c.style.left = `${view.left - origin.x}px`
      c.style.top = `${view.top - origin.y}px`
      c.style.width = `${view.right - view.left}px`
      c.style.height = `${view.bottom - view.top}px`
    }
    /** The box, from the anchor and the last pointer point. Written straight
     *  onto the element: no render, no layout read. */
    const paint = (): void => {
      const c = clip.current
      const band = c?.firstElementChild as HTMLElement | null | undefined
      if (!c || !band || !started || cancelled || !geo || !view) return
      const o = opts.current
      const anchor = clampToView(o.toClient(start, geo), view)
      const at = clampToView(o.toClient(o.toList(last.x, last.y, geo), geo), view)
      const s = snapBox(anchor, at, dpr)
      band.style.left = `${s.left - view.left}px`
      band.style.top = `${s.top - view.top}px`
      band.style.width = `${s.width}px`
      band.style.height = `${s.height}px`
      if (c.style.display !== 'block') c.style.display = 'block'
    }
    /** Is this row inside what the sweep marks? */
    const covered = (index: number, path: string): boolean =>
      inSpan(span, index) || (add && opts.current.held(path))
    /** The marks on the rows in view, from the current span. */
    const paintMarks = (): void => {
      if (!started || cancelled) return
      marking = true
      const o = opts.current
      for (const r of o.rows()) {
        const on = covered(r.index, r.path)
        attr(r.el, 'data-sweep-mark', sweepMark(on, o.held(r.path)))
        attr(r.el, 'data-sweep-up', on && r.up && covered(r.up.index, r.up.path) ? '' : null)
        attr(r.el, 'data-sweep-down', on && r.down && covered(r.down.index, r.down.path) ? '' : null)
      }
    }
    const clearMarks = (): void => {
      marking = false
      if (!box) return
      for (const el of box.querySelectorAll<HTMLElement>('[data-sweep-mark],[data-sweep-up],[data-sweep-down]'))
        for (const a of MARK_ATTRS) el.removeAttribute(a)
    }
    /** What the box covers, from the latest position. At most once a frame
     *  while it moves, and once more on the release; the rows are touched only
     *  when the covered run changed. */
    const mark = (): void => {
      dirty = false
      const o = opts.current
      if (!geo) return
      const at = o.toList(last.x, last.y, geo)
      across ??= o.rowAcross()
      const next = o.span(
        {
          left: Math.min(start.x, at.x),
          right: Math.max(start.x, at.x),
          top: Math.min(start.y, at.y),
          bottom: Math.max(start.y, at.y)
        },
        at.y,
        across
      )
      const changed = !sameSpan(span, next) || !marking
      span = next
      if (changed) paintMarks()
    }
    // The list scrolled (a wheel under the held button, or our own scroll):
    // the anchor moved with the rows and the far corner is still under the
    // pointer, so the box is drawn again, in this frame (scroll events come
    // before the frame is painted).
    const scrolled = (): void => {
      if (!started || cancelled) return
      remeasure()
      paint()
      dirty = true
    }
    // Its layout changed (rows added or removed by the watcher, a window or
    // pane resize): the scroller's box may have moved too.
    const relaid = (): void => {
      if (!started || cancelled) return
      remeasure()
      measureView()
      paint()
      dirty = true
    }
    // Every frame of the sweep: auto-scroll while the pointer sits near an
    // edge of the list (the pointer is the user's own hand, so it runs under
    // reduced motion too, at half the speed), then the marks, if anything
    // moved. Runs before the frame is drawn, so what it changes is in it.
    const tick = (): void => {
      frame = 0
      if (!started || cancelled) return
      if (box && view) {
        const dy = edgeSpeed(last.y, view.top, view.bottom, 36, still ? 11 : 22)
        if (dy) {
          const before = box.scrollTop
          opts.current.scrollBy(dy)
          if (box.scrollTop !== before) scrolled()
        }
      }
      if (dirty) mark()
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
    /** Ends the sweep. `commit` hands the result to React; it runs in a
     *  `flushSync` BEFORE the hook's marks come off, in one task, so the frame
     *  after the release shows React's marks and never a frame of neither. */
    const cleanup = (commit?: () => void): void => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', abort, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', abort)
      box?.removeEventListener('scroll', scrolled)
      window.removeEventListener('resize', relaid)
      resized?.disconnect()
      resized = null
      added?.disconnect()
      added = null
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      if (row) row.draggable = wasDraggable
      if (box?.hasPointerCapture?.(pointerId)) box.releasePointerCapture(pointerId)
      // Gone in this frame, before React gets round to unmounting it.
      if (clip.current) clip.current.style.display = 'none'
      draw.current = null
      stop.current = null
      if (commit)
        flushSync(() => {
          setSweeping(false)
          commit()
        })
      else setSweeping(false)
      clearMarks()
      box?.removeAttribute('data-sweeping')
    }
    const finish = (): void => {
      const wasSweep = started && !cancelled
      // The marks that stand are the box's at the release, never a frame old:
      // measured again first, since a wheel turn just before the release has
      // moved the list but not yet sent its scroll event. One layout read.
      if (!wasSweep) return cleanup()
      remeasure()
      mark()
      const o = opts.current
      const result = span ? o.pathsIn(span) : { paths: [], near: null }
      cleanup(() => o.onEnd(result.paths, result.near, add))
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
        box?.addEventListener('scroll', scrolled, { passive: true })
        window.addEventListener('resize', relaid)
        if (box && typeof ResizeObserver !== 'undefined') {
          // The box and what it holds (the list grows or shrinks as rows come
          // and go).
          resized = new ResizeObserver(relaid)
          resized.observe(box)
          for (const child of box.children) resized.observe(child)
          const tree = box.querySelector('[role="tree"]')
          if (tree && tree.parentElement !== box) resized.observe(tree)
        }
        if (box && typeof MutationObserver !== 'undefined') {
          // A render that drew new rows (the list scrolled to them) drew them
          // with React's marks: they get the sweep's before the frame is
          // painted (observer callbacks run right after the commit).
          added = new MutationObserver(() => {
            if (marking) paintMarks()
          })
          added.observe(box, { childList: true, subtree: true })
        }
        // Captured only now: a capture from the press would retarget the click
        // of a plain press, and that click is today's behaviour.
        try {
          box?.setPointerCapture(pointerId)
        } catch {
          /* the pointer already went; the window listeners still hear it */
        }
        window.getSelection()?.removeAllRanges()
        measureView()
        draw.current = (): void => {
          const band = clip.current?.firstElementChild as HTMLElement | null | undefined
          // One device pixel of edge, whatever the zoom (#332): a 1px CSS
          // border is 2.25 device pixels at 225% and is snapped on its own.
          band?.style.setProperty('--sweep-hair', `${1 / dpr}px`)
          measureView()
          paint()
        }
        // Synchronous, once per sweep: the band is in the DOM (and placed, by
        // `bandRef`) before this frame is painted.
        flushSync(() => setSweeping(true))
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
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      if (clip.current) clip.current.style.display = 'none'
      setSweeping(false)
      // React never saw the sweep: taking the hook's marks away is the undo.
      clearMarks()
      opts.current.onCancel()
      // Still listening for the release, so its click is eaten too.
    }
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', abort, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', abort)
    stop.current = () => cleanup()
  }, [])

  return { sweeping, bandRef, begin }
}
