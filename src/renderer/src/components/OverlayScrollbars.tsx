import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { createPortal } from 'react-dom'
import { sameTracks, scrollsByStyle, thumbFor, type Axis, type Bar } from '../lib/overlayScroll'

/**
 * EVERY SCROLLBAR IS THE FILE LIST'S (owner, 2026-10-27: "the sidebar
 * scrollbar should be more minimalistic all scrollbars should be the same.
 * the one on the main view of the explorer is pretty good so reuse that").
 *
 * The file list draws its own (`browse/OverlayScrollbar.tsx`, #267): a 4 px
 * thumb that shows only while the list scrolls, fades out 900 ms after, and
 * widens to 6 px under the pointer so it can be grabbed. This is the same bar
 * for everything else that scrolls (the places panel, Settings, menus, the
 * viewers): one listener on the document catches every scroll (scroll events
 * do not bubble, but they reach a capturing listener), and one bar per axis is
 * drawn over whichever element scrolled, in the same classes. Native bars are
 * hidden while this is mounted (`p-overlay-scrollbars` on <html>, index.css).
 * An element marked `data-own-scrollbar` draws its own or none on purpose:
 * the file list (its own bar), the address bar's crumbs (scrolled to keep the
 * path's end in view) and the drive legend (its own "more" fade).
 *
 * Review, 2026-10-28: an axis the element's style does not let scroll
 * (`overflow: hidden`) gets no bar; a scroll that only moves the thumbs writes
 * them straight to the thumb, and React renders only when a track changes; a
 * bar that goes away under the pointer, or a drag the system cancels, no
 * longer leaves the bar held shown and every other scroller ignored; and
 * outside-press closers let a press on the bar be (`data-overlay-scrollbar`,
 * `onOverlayScrollbar`), so a scrolled menu's thumb can be dragged.
 */

const HIDE_MS = 900

type Axes = Record<Axis, boolean>

/** Which axes the element's own style lets scroll; the page scrolls both. */
function axesOf(el: HTMLElement): Axes {
  if (el === document.scrollingElement) return { x: true, y: true }
  const cs = getComputedStyle(el)
  return { x: scrollsByStyle(cs.overflowX), y: scrollsByStyle(cs.overflowY) }
}

function barsOf(el: HTMLElement, axes: Axes): Bar[] {
  const r = el.getBoundingClientRect()
  const left = r.left + el.clientLeft
  const top = r.top + el.clientTop
  const out: Bar[] = []
  const y = axes.y ? thumbFor(el, 'y') : null
  if (y?.scrollable)
    out.push({ axis: 'y', left: left + el.clientWidth - 10, top, length: el.clientHeight, thumb: y })
  const x = axes.x ? thumbFor(el, 'x') : null
  if (x?.scrollable)
    out.push({ axis: 'x', left, top: top + el.clientHeight - 10, length: el.clientWidth, thumb: x })
  return out
}

function placeThumbs(thumbs: Record<Axis, HTMLDivElement | null>, bars: readonly Bar[]): void {
  for (const b of bars) {
    const t = thumbs[b.axis]
    if (t) t.style[b.axis === 'y' ? 'top' : 'left'] = `${b.thumb.start}px`
  }
}

function scrollerOf(target: EventTarget | null): HTMLElement | null {
  if (target instanceof Document) return (target.scrollingElement as HTMLElement | null) ?? null
  return target instanceof HTMLElement ? target : null
}

export function OverlayScrollbars(): JSX.Element | null {
  const [bars, setBars] = useState<Bar[]>([])
  const [shown, setShown] = useState(false)
  const el = useRef<HTMLElement | null>(null)
  const axes = useRef<Axes>({ x: false, y: false })
  const drawn = useRef<Bar[]>([])
  const thumbs = useRef<Record<Axis, HTMLDivElement | null>>({ x: null, y: null })
  const hover = useRef(false)
  const drag = useRef<{ axis: Axis; start: number; from: number } | null>(null)
  const idle = useRef(0)

  // The thumbs' offsets are never React's: a render places them from the
  // latest measure, and a scroll that moved only them places them itself.
  useLayoutEffect(() => placeThumbs(thumbs.current, drawn.current), [bars])

  useEffect(() => {
    const root = document.documentElement
    root.classList.add('p-overlay-scrollbars')
    const measure = (): void => {
      const cur = el.current
      const next = cur && cur.isConnected ? barsOf(cur, axes.current) : []
      // No bar, no pointer on it and no drag: a bar that unmounted under the
      // pointer never sees its leave or its release.
      if (!next.length) {
        hover.current = false
        drag.current = null
      }
      const same = sameTracks(drawn.current, next)
      drawn.current = next
      if (same) placeThumbs(thumbs.current, next)
      else setBars(next)
    }
    const hideLater = (): void => {
      window.clearTimeout(idle.current)
      idle.current = window.setTimeout(() => {
        if (!hover.current && !drag.current) setShown(false)
      }, HIDE_MS)
    }
    const ro = new ResizeObserver(measure)
    const onScroll = (e: Event): void => {
      const target = scrollerOf(e.target)
      if (!target || target.closest('[data-own-scrollbar]')) return
      if (target !== el.current) {
        if (drag.current) return
        const next = axesOf(target)
        if (!next.x && !next.y) return
        ro.disconnect()
        el.current = target
        axes.current = next
        hover.current = false
        ro.observe(target)
      }
      measure()
      setShown(true)
      hideLater()
    }
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    window.addEventListener('resize', measure)
    return () => {
      root.classList.remove('p-overlay-scrollbars')
      window.clearTimeout(idle.current)
      document.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('resize', measure)
      ro.disconnect()
    }
  }, [])

  const hideSoon = (): void => {
    window.clearTimeout(idle.current)
    idle.current = window.setTimeout(() => setShown(false), HIDE_MS)
  }

  /** The drag is over: released, cancelled by the system, or its capture lost. */
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
    if (!hover.current) hideSoon()
  }

  if (!bars.length) return null
  return createPortal(
    <>
      {bars.map((b) => (
        <div
          key={b.axis}
          className="browse-overlay-scroll p-overlay-fixed"
          data-axis={b.axis}
          data-overlay-scrollbar
          data-shown={shown || undefined}
          aria-hidden
          style={
            b.axis === 'y'
              ? { left: b.left, top: b.top, height: b.length }
              : { left: b.left, top: b.top, width: b.length }
          }
          onPointerEnter={() => {
            hover.current = true
            window.clearTimeout(idle.current)
          }}
          onPointerLeave={() => {
            hover.current = false
            if (!drag.current) hideSoon()
          }}
        >
          <div
            className="browse-overlay-thumb"
            ref={(t) => {
              thumbs.current[b.axis] = t
            }}
            style={b.axis === 'y' ? { height: b.thumb.size } : { width: b.thumb.size }}
            onPointerDown={(e) => {
              const cur = el.current
              if (!cur || e.button !== 0) return
              e.preventDefault()
              e.currentTarget.setPointerCapture(e.pointerId)
              drag.current =
                b.axis === 'y'
                  ? { axis: 'y', start: e.clientY, from: cur.scrollTop }
                  : { axis: 'x', start: e.clientX, from: cur.scrollLeft }
            }}
            onPointerMove={(e) => {
              const cur = el.current
              const d = drag.current
              if (!cur || !d || d.axis !== b.axis) return
              const range = b.length - b.thumb.size
              if (range <= 0) return
              if (d.axis === 'y') {
                cur.scrollTop =
                  d.from + (e.clientY - d.start) * ((cur.scrollHeight - cur.clientHeight) / range)
              } else {
                cur.scrollLeft =
                  d.from + (e.clientX - d.start) * ((cur.scrollWidth - cur.clientWidth) / range)
              }
            }}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onLostPointerCapture={endDrag}
          />
        </div>
      ))}
    </>,
    document.body
  )
}
