import { useEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { thumbFor, type Axis, type Thumb } from '../lib/overlayScroll'

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
 */

const HIDE_MS = 900

interface Bar {
  axis: Axis
  /** The track's box on screen (fixed). */
  left: number
  top: number
  length: number
  thumb: Thumb
}

function barsOf(el: Element): Bar[] {
  const r = el.getBoundingClientRect()
  const m = el as HTMLElement
  const left = r.left + m.clientLeft
  const top = r.top + m.clientTop
  const out: Bar[] = []
  const y = thumbFor(m, 'y')
  if (y.scrollable)
    out.push({ axis: 'y', left: left + m.clientWidth - 10, top, length: m.clientHeight, thumb: y })
  const x = thumbFor(m, 'x')
  if (x.scrollable)
    out.push({ axis: 'x', left, top: top + m.clientHeight - 10, length: m.clientWidth, thumb: x })
  return out
}

function scrollerOf(target: EventTarget | null): HTMLElement | null {
  if (target instanceof Document) return (target.scrollingElement as HTMLElement | null) ?? null
  return target instanceof HTMLElement ? target : null
}

export function OverlayScrollbars(): JSX.Element | null {
  const [bars, setBars] = useState<Bar[]>([])
  const [shown, setShown] = useState(false)
  const el = useRef<HTMLElement | null>(null)
  const hover = useRef(false)
  const drag = useRef<{ axis: Axis; start: number; from: number } | null>(null)
  const idle = useRef(0)

  useEffect(() => {
    const root = document.documentElement
    root.classList.add('p-overlay-scrollbars')
    const measure = (): void => {
      const cur = el.current
      setBars(cur && cur.isConnected ? barsOf(cur) : [])
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
        ro.disconnect()
        el.current = target
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

  if (!bars.length) return null
  return createPortal(
    <>
      {bars.map((b) => (
        <div
          key={b.axis}
          className="browse-overlay-scroll p-overlay-fixed"
          data-axis={b.axis}
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
            style={
              b.axis === 'y'
                ? { top: b.thumb.start, height: b.thumb.size }
                : { left: b.thumb.start, width: b.thumb.size }
            }
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
            onPointerUp={(e) => {
              drag.current = null
              e.currentTarget.releasePointerCapture(e.pointerId)
              if (!hover.current) hideSoon()
            }}
          />
        </div>
      ))}
    </>,
    document.body
  )
}
