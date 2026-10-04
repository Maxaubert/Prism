import { useEffect, useRef, useState, type JSX, type RefObject } from 'react'

/**
 * THE FILE LIST'S OWN SCROLLBAR (#267; owner, 2026-10-04: "the scrollbar is
 * too distracting", then of a native one faded with CSS: "its visibility is
 * buggy, sometimes it fades on nothing happening, sometimes it doesn't ... it
 * disappears too abruptly, it should fade quickly but not instantly").
 *
 * Chromium repaints a native scrollbar only on some events and never
 * animates it, so its :hover and a scroll flag showed and hid it at random and
 * with no fade. This one is drawn by Prism over the list, which keeps its
 * native bar hidden. One rule: it shows while the list scrolls or the pointer
 * is over the list (or dragging the thumb), and hides 900 ms after the last
 * of those, fading in quickly and out softly. It can still be dragged.
 */
/** Outside the component: the list is the DOM's, not render state. */
function scrollListTo(list: HTMLElement, top: number): void {
  list.scrollTop = top
}

export function OverlayScrollbar(props: { target: RefObject<HTMLElement | null> }): JSX.Element | null {
  const [box, setBox] = useState({ top: 0, height: 0, thumbTop: 0, thumbHeight: 0, scrollable: false })
  const [shown, setShown] = useState(false)
  const hover = useRef(false)
  const dragging = useRef<{ startY: number; startTop: number } | null>(null)
  const idle = useRef(0)

  useEffect(() => {
    const list = props.target.current
    if (!list) return
    const measure = (): void => {
      const { scrollTop, scrollHeight, clientHeight, offsetTop } = list
      const scrollable = scrollHeight > clientHeight + 1
      const thumbHeight = scrollable ? Math.max(28, (clientHeight * clientHeight) / scrollHeight) : 0
      const range = clientHeight - thumbHeight
      const thumbTop = scrollable ? (scrollTop / (scrollHeight - clientHeight)) * range : 0
      setBox({ top: offsetTop, height: clientHeight, thumbTop, thumbHeight, scrollable })
    }
    const hideLater = (): void => {
      window.clearTimeout(idle.current)
      idle.current = window.setTimeout(() => {
        if (!hover.current && !dragging.current) setShown(false)
      }, 900)
    }
    const onScroll = (): void => {
      measure()
      setShown(true)
      hideLater()
    }
    const onEnter = (): void => {
      hover.current = true
      measure()
      setShown(true)
      window.clearTimeout(idle.current)
    }
    const onLeave = (): void => {
      hover.current = false
      hideLater()
    }
    measure()
    list.addEventListener('scroll', onScroll, { passive: true })
    list.addEventListener('pointerenter', onEnter)
    list.addEventListener('pointerleave', onLeave)
    const ro = new ResizeObserver(measure)
    ro.observe(list)
    if (list.firstElementChild) ro.observe(list.firstElementChild)
    return () => {
      window.clearTimeout(idle.current)
      list.removeEventListener('scroll', onScroll)
      list.removeEventListener('pointerenter', onEnter)
      list.removeEventListener('pointerleave', onLeave)
      ro.disconnect()
    }
  }, [props.target])

  if (!box.scrollable) return null
  return (
    <div
      className="browse-overlay-scroll"
      data-shown={shown || undefined}
      aria-hidden
      style={{ top: box.top, height: box.height }}
      onPointerEnter={() => {
        hover.current = true
        setShown(true)
        window.clearTimeout(idle.current)
      }}
    >
      <div
        className="browse-overlay-thumb"
        style={{ top: box.thumbTop, height: box.thumbHeight }}
        onPointerDown={(e) => {
          const list = props.target.current
          if (!list || e.button !== 0) return
          e.preventDefault()
          e.currentTarget.setPointerCapture(e.pointerId)
          dragging.current = { startY: e.clientY, startTop: list.scrollTop }
        }}
        onPointerMove={(e) => {
          const list = props.target.current
          const drag = dragging.current
          if (!list || !drag) return
          const range = list.clientHeight - box.thumbHeight
          if (range <= 0) return
          const ratio = (list.scrollHeight - list.clientHeight) / range
          scrollListTo(list, drag.startTop + (e.clientY - drag.startY) * ratio)
        }}
        onPointerUp={(e) => {
          dragging.current = null
          e.currentTarget.releasePointerCapture(e.pointerId)
          if (!hover.current) {
            window.clearTimeout(idle.current)
            idle.current = window.setTimeout(() => setShown(false), 900)
          }
        }}
      />
    </div>
  )
}
