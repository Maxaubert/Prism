import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { LAYER } from './layers'
import { placeTip, type TipSide, type TipSpot } from '../lib/tipPlace'

/**
 * THE APP'S OWN TOOLTIPS, FOR EVERY `title` (owner, 2026-10-13: "make the
 * tooltips appear at the right place ... they dont appear under it centered,
 * they appear from bottom right of that item ... just as a general rule for
 * icons and so on"; Prism the same). Windows draws a `title` at the POINTER,
 * below and right of it, so a tip never sat where its item is. Mounted ONCE by
 * each host; every element keeps its plain `title` attribute and nothing else
 * changes: while the pointer is on an element, its title is set aside (so
 * Windows has none to draw) and drawn here instead, placed by `placeTip`:
 * centred under the item, above it when there is no room, beside it where an
 * ancestor says `data-tip-side="right"`. The title goes back on the element
 * when the pointer leaves, so the DOM is as it was.
 *
 * A title set as the pointer arrives (`hiddenTitle`, which only titles text
 * that is cut off) or changed while it is there ("Copy" to "Copied") is
 * followed: a watcher on the element's own title.
 */

/** How long the pointer rests on an item before its tip shows: 1 s (owner,
 *  2026-10-15: "the tooltips appear a bit too slow make it maybe 1 second";
 *  1.5 s the day before, "right now they appear too fast"; it was Windows' own
 *  450 ms). A pointer passing over a row of icons lights none of them. */
export const SHOW_MS = 1000

interface Shown {
  text: string
  item: DOMRect
  prefer: TipSide
}

/** The element whose title the pointer is on, or null. */
function titled(el: EventTarget | null): HTMLElement | null {
  let n = el instanceof Element ? (el as HTMLElement) : null
  while (n && n !== document.body) {
    if (n.hasAttribute('title') || n.dataset.tipTitle !== undefined) return n
    n = n.parentElement
  }
  return null
}

/**
 * The box the tip is placed by: the item's own, or the ancestor it names with
 * `data-tip-to` (a selector). A tab's title sits on its name, a part of the
 * tab, and a tip placed by the name sat off the tab: off-centre under the strip's
 * tab, and in the sidebar over the card's own ring and close (owner,
 * 2026-10-15: "the tooltip that appears when you hover over a tab that shows
 * the path is placed oddly").
 */
function boxOf(el: HTMLElement): DOMRect {
  const sel = el.dataset.tipTo
  const to = sel ? el.closest<HTMLElement>(sel) : null
  return (to ?? el).getBoundingClientRect()
}

const sideOf = (el: HTMLElement): TipSide => {
  const v = el.closest<HTMLElement>('[data-tip-side]')?.dataset.tipSide
  return v === 'right' || v === 'left' || v === 'above' ? v : 'below'
}

export default function Tooltips(): JSX.Element | null {
  const [shown, setShown] = useState<Shown | null>(null)
  const [spot, setSpot] = useState<TipSpot | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let current: HTMLElement | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let watch: MutationObserver | null = null

    /** Move the element's title aside, so Windows draws nothing. */
    const takeTitle = (el: HTMLElement): void => {
      const t = el.getAttribute('title')
      if (t === null) return
      el.dataset.tipTitle = t
      el.removeAttribute('title')
    }
    const giveBack = (el: HTMLElement): void => {
      const t = el.dataset.tipTitle
      delete el.dataset.tipTitle
      if (t !== undefined && t !== '' && !el.hasAttribute('title')) el.setAttribute('title', t)
    }
    const clear = (): void => {
      if (timer) clearTimeout(timer)
      timer = null
      watch?.disconnect()
      watch = null
      if (current) giveBack(current)
      current = null
      setShown(null)
    }
    const show = (): void => {
      const el = current
      if (!el || !el.isConnected) return
      takeTitle(el)
      const text = el.dataset.tipTitle ?? ''
      if (!text.trim()) return setShown(null)
      setShown({ text, item: boxOf(el), prefer: sideOf(el) })
    }
    const onOver = (e: MouseEvent): void => {
      const el = titled(e.target)
      if (el === current) return
      clear()
      if (!el) return
      current = el
      // After the element's own mouseenter has had its say (hiddenTitle sets
      // the title then), well inside Windows' own wait.
      setTimeout(() => {
        if (current === el) takeTitle(el)
      }, 0)
      watch = new MutationObserver(() => {
        if (current !== el || !el.hasAttribute('title')) return
        takeTitle(el)
        if (timer === null) show()
      })
      watch.observe(el, { attributes: true, attributeFilter: ['title'] })
      timer = setTimeout(() => {
        timer = null
        show()
      }, SHOW_MS)
    }
    const onOut = (e: MouseEvent): void => {
      if (!current) return
      const to = e.relatedTarget
      if (to instanceof Node && current.contains(to)) return
      clear()
    }
    // A press, a key, a scroll or the window losing focus: the tip goes, as
    // Windows' does.
    const away = (): void => clear()
    document.addEventListener('mouseover', onOver)
    document.addEventListener('mouseout', onOut)
    document.addEventListener('pointerdown', away, true)
    document.addEventListener('keydown', away, true)
    document.addEventListener('wheel', away, { capture: true, passive: true })
    window.addEventListener('blur', away)
    return () => {
      clear()
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mouseout', onOut)
      document.removeEventListener('pointerdown', away, true)
      document.removeEventListener('keydown', away, true)
      document.removeEventListener('wheel', away, { capture: true })
      window.removeEventListener('blur', away)
    }
  }, [])

  // Placed once its own size is known, before it paints.
  useLayoutEffect(() => {
    const el = tipRef.current
    if (!shown || !el) return setSpot(null)
    const r = el.getBoundingClientRect()
    setSpot(
      placeTip(
        { left: shown.item.left, top: shown.item.top, width: shown.item.width, height: shown.item.height },
        { width: r.width, height: r.height },
        { width: window.innerWidth, height: window.innerHeight },
        shown.prefer
      )
    )
  }, [shown])

  if (!shown) return null
  const lean = spot?.side === 'above' ? 'translateY(2px)' : spot?.side === 'right' ? 'translateX(-2px)' : spot?.side === 'left' ? 'translateX(2px)' : 'translateY(-2px)'
  return createPortal(
    <div
      ref={tipRef}
      data-tip
      data-tip-placed={spot?.side}
      role="tooltip"
      style={{
        left: spot?.x ?? -9999,
        top: spot?.y ?? -9999,
        animation: spot ? 'p-tip-in 120ms cubic-bezier(0.16,1,0.3,1) both' : undefined,
        ['--p-tip-lean' as string]: lean
      }}
      className={`pointer-events-none fixed ${LAYER.tip} max-w-[320px] whitespace-pre-line rounded-[6px] border border-[color:var(--p-divider)] bg-[var(--p-side-flat)] px-2 py-1 text-[12px] leading-[1.35] text-[var(--p-text)] shadow-[0_6px_18px_-6px_rgba(0,0,0,.55)]`}
    >
      {shown.text}
      <style>{'@keyframes p-tip-in{from{opacity:0;transform:var(--p-tip-lean)}to{opacity:1;transform:none}}'}</style>
    </div>,
    document.body
  )
}
