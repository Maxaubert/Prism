import { useEffect, useRef, type RefObject } from 'react'
import { NAV_SURFACE, isTextBox } from './focusGuards'

/**
 * Ctrl+F for a document viewer (DocView, MarkdownView): opens its find bar.
 *
 * Ctrl+F belongs to the open document whether or not it has focus, and
 * nothing focuses a document on arrival (2026-08-17), so this is a window
 * listener rather than one on the viewer's subtree - the same shape PdfView
 * and CodeView use. Capture, so it lands before anything else claims the key.
 *
 * Ctrl+F belongs to the document you are LOOKING at (2026-08-30).
 *
 * A window listener is right - nothing focuses a document on arrival, so
 * this key has to work without focus - but "the window" holds more than one
 * viewer: split view mounts up to four, and the media deck keeps others
 * alive behind the strip. Without an ownership test every mounted document
 * opened its own find bar, and the last one to register won the focus, so
 * pressing Ctrl+F over a PDF opened the markdown pane's bar instead.
 *
 * Three tests, cheapest first: not covered by Settings (`[inert]`, the same
 * check PdfView makes), not in a hidden tab, and either this pane holds the
 * focus or nothing in another pane does.
 */
export function ownsFindKeys(el: HTMLElement | null): boolean {
  if (!el || el.closest('[inert]') || el.closest('[hidden]')) return false
  if (!el.isConnected || !el.offsetParent) return false
  const active = document.activeElement as HTMLElement | null
  if (active && active !== document.body) {
    // Somebody has the focus: only the pane containing it may answer.
    const pane = active.closest('[data-doc-scroller], .cm-editor, [data-pdf-scroller]')
    if (pane && pane !== el && !el.contains(active)) return false
  }
  return true
}

/** Registered once; reads the latest `onFind` from a ref. */
export function useFindShortcut(box: RefObject<HTMLElement | null>, onFind: () => void): void {
  const find = useRef(onFind)
  useEffect(() => {
    find.current = onFind
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey && (e.key === 'f' || e.key === 'F'))) return
      const el = e.target as HTMLElement | null
      if (e.defaultPrevented || el?.closest(NAV_SURFACE)) return
      if (isTextBox(el)) return
      if (!ownsFindKeys(box.current)) return
      e.preventDefault()
      e.stopPropagation()
      find.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [box])
}
