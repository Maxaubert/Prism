import { useEffect, useRef, type RefObject } from 'react'
import { EDITOR, FIELD, OVERLAY } from '../../lib/focusGuards'

/**
 * CTRL+F FROM THE PREVIEW, OR FROM NOWHERE, IS THE EXPLORER'S SEARCH when what
 * is previewed has no find of its own (owner, 2026-11-04: "clicking ctrl f on a
 * preview sometimes opens fullscreen and sometimes opens the find tool like it
 * should").
 *
 * The shell's own onKeyDown only hears a key pressed INSIDE the Explorer, and
 * the preview pane is its sibling: a click on a picture or a film leaves the
 * focus on the page (body) or in the pane, so Ctrl+F reached no one but the
 * viewers' plain F (now `fullscreenKey.ts`). A document in the preview keeps
 * its own find: PdfView, CodeView and the doc viewers claim the key with
 * preventDefault, so this decides only AFTER the dispatch has finished (a
 * window listener cannot know whether a listener registered after it will
 * claim the key; PdfView's is one of those).
 */
export function useFindFallback(shell: RefObject<HTMLElement | null>, openSearch: () => void): void {
  const open = useRef(openSearch)
  useEffect(() => {
    open.current = openSearch
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return
      if (e.key !== 'f' && e.key !== 'F') return
      if (e.defaultPrevented || e.repeat) return
      const el = e.target as HTMLElement | null
      // Inside the Explorer the shell's own handler answers; a field, an
      // editor, a menu or a dialog keeps its keys.
      const fromPreview = !el || el === document.body || !!el.closest('[data-workspace-viewer]')
      if (!fromPreview || el?.closest(`${FIELD},${EDITOR},${OVERLAY},[inert]`)) return
      if (!shell.current?.isConnected || shell.current.closest('[inert]')) return
      setTimeout(() => {
        if (!e.defaultPrevented && shell.current?.isConnected) open.current()
      }, 0)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shell])
}
