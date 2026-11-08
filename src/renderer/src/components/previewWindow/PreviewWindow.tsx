import { useEffect, useLayoutEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { previewWindowKey, typesText } from '../../lib/previewWindowKeys'
import { logNote } from '../../lib/noteLog'
import './previewWindow.css'

/**
 * THE PREVIEW WINDOW, QUICK LOOK STYLE (owner, 2026-11-08: "build a setting
 * to have a preview which opens as a separate window. just like apple does it,
 * space opens and closes that too. it needs to animate and should not
 * disappear on alt tab, only on space").
 *
 * A window of this page's own: `window.open` under the one-time name main
 * armed (`src/main/previewWindow.ts`), dressed in this document's styles and
 * theme, and the preview's own viewer rendered into it through a portal, so it
 * is the pane's viewer, the pane's file and the pane's grants, in another
 * frame. Main frames it (frameless, owned, centred, shown inactive so the
 * keyboard stays in the list) and fades it; the body zooms in with it.
 *
 * It closes on Space and Escape (the list's, or its own), on its close
 * button, and when main says it closed by itself (Alt+F4). Never on a blur.
 * `open` false is the close: the fade runs while App keeps it mounted
 * (`useLinger`), and the unmount takes it away.
 *
 * Right-click does nothing in it: a menu would open in the Explorer behind.
 */
export function PreviewWindow({
  open,
  title,
  onClose,
  children
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}): JSX.Element | null {
  const [host, setHost] = useState<{ win: Window; root: HTMLElement } | null>(null)
  const close = useRef(onClose)
  useLayoutEffect(() => {
    close.current = onClose
  })
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches

  // Made once, when App mounts it; gone when App unmounts it.
  useEffect(() => {
    let gone = false
    let made: { win: Window; undress: () => void } | null = null
    void window.prism
      .previewWindowArm()
      .then((name) => {
        if (gone) return
        const win = name ? window.open('', name) : null
        if (!win) {
          logNote('The preview window could not open.', { op: 'preview-window' })
          close.current()
          return
        }
        const undress = dress(win)
        const root = win.document.createElement('div')
        root.className = 'preview-window-host'
        win.document.body.appendChild(root)
        made = { win, undress }
        // The e2e reads the window's own document (under --e2e only, where
        // the preload also swaps in its clipboard).
        if (window.prism.e2eClipboard) Object.assign(window, { __prismPreviewWindow: win })
        setHost({ win, root })
      })
      .catch(() => close.current())
    return () => {
      gone = true
      // Already fading out if App closed it first; this is the end of it.
      window.prism.previewWindowClose(false)
      made?.undress()
    }
  }, [])

  // On screen once its contents are in, inactive, fading in.
  const shown = useRef(false)
  useEffect(() => {
    if (!host || !open || shown.current) return
    shown.current = true
    const frame = requestAnimationFrame(() => window.prism.previewWindowShow(!still))
    return () => cancelAnimationFrame(frame)
  }, [host, open, still])
  // Closing: the fade runs out before App unmounts it.
  useEffect(() => {
    if (host && !open) window.prism.previewWindowClose(!still)
  }, [host, open, still])

  // Alt+F4 on the window itself.
  useEffect(() => window.prism.onPreviewWindowGone(() => close.current()), [])

  // Its own keys: Space and Escape close it, as Quick Look's do.
  useEffect(() => {
    if (!host) return
    const doc = host.win.document
    const onKey = (e: KeyboardEvent): void => {
      const k = previewWindowKey(e, typesText(e.target))
      if (!k) return
      e.preventDefault()
      e.stopPropagation()
      if (k === 'close') close.current()
    }
    // A focused button's Space clicks it on the way up: not here.
    const onKeyUp = (e: KeyboardEvent): void => {
      if (previewWindowKey(e, typesText(e.target))) e.preventDefault()
    }
    doc.addEventListener('keydown', onKey)
    doc.addEventListener('keyup', onKeyUp)
    return () => {
      doc.removeEventListener('keydown', onKey)
      doc.removeEventListener('keyup', onKeyUp)
    }
  }, [host])

  useEffect(() => {
    if (host) nameWindow(host.win, title)
  }, [host, title])

  if (!host) return null
  return createPortal(
    <div
      className="preview-window"
      data-preview-window
      data-phase={open ? 'in' : 'out'}
      data-still={still || undefined}
      onContextMenuCapture={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <header className="preview-window-bar drag">
        <span className="preview-window-title" title={title}>
          {title}
        </span>
        <button
          className="no-drag grid h-7 w-8 place-items-center rounded text-[var(--p-icon)] hover:bg-red-500/80 hover:text-[var(--p-text)]"
          onClick={() => close.current()}
          aria-label="Close preview"
          data-preview-window-close
        >
          ✕
        </button>
      </header>
      <div className="preview-window-body" data-preview-window-body>
        {children}
      </div>
    </div>,
    host.root
  )
}

/** The window's title, the file's name (main's frame takes it from here). */
function nameWindow(win: Window, title: string): void {
  win.document.title = title || 'Preview'
}

/**
 * This document's look on the window's: every stylesheet (and any added
 * later, a lazy viewer's), the root's theme variables and mode, the body's
 * classes. Kept in step until `undress`.
 */
function dress(win: Window): () => void {
  const doc = win.document
  const copies = new Map<Node, Node>()
  const copy = (n: Node): void => {
    if (!(
      n instanceof HTMLStyleElement ||
      (n instanceof HTMLLinkElement && n.rel === 'stylesheet')
    ))
      return
    const c = n.cloneNode(true) as HTMLElement
    // A link's address in full: the blank page's own base is not the app's.
    if (n instanceof HTMLLinkElement) (c as HTMLLinkElement).href = n.href
    copies.set(n, c)
    doc.head.appendChild(c)
  }
  document.head.childNodes.forEach(copy)
  const mirror = (from: Element, to: Element): void => {
    for (const a of [...to.attributes]) if (!from.hasAttribute(a.name)) to.removeAttribute(a.name)
    for (const a of [...from.attributes]) to.setAttribute(a.name, a.value)
  }
  mirror(document.documentElement, doc.documentElement)
  mirror(document.body, doc.body)
  const heads = new MutationObserver((records) => {
    for (const r of records) {
      r.addedNodes.forEach(copy)
      r.removedNodes.forEach((n) => {
        const c = copies.get(n)
        if (c) (c as ChildNode).remove()
        copies.delete(n)
      })
    }
  })
  heads.observe(document.head, { childList: true })
  const looks = new MutationObserver(() => {
    mirror(document.documentElement, doc.documentElement)
    mirror(document.body, doc.body)
  })
  looks.observe(document.documentElement, { attributes: true })
  looks.observe(document.body, { attributes: true })
  return () => {
    heads.disconnect()
    looks.disconnect()
  }
}
