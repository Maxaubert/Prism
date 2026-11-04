import { useEffect, useRef, type RefObject } from 'react'
import { EDITOR, FIELD, OVERLAY } from '../../lib/focusGuards'
import { findRoute, type FindSelection } from '../../lib/findRoute'
import { inPreview, openPreviewFind, previewFindSurface } from '../../lib/previewFind'

type FindKeyEvent = Pick<
  KeyboardEvent,
  'key' | 'shiftKey' | 'target' | 'preventDefault' | 'stopPropagation'
>

/**
 * CTRL+F IN THE EXPLORER OPENS ONE FIND, CHOSEN BY THE RULE IN
 * `lib/findRoute.ts` (owner, 2026-11-04): the selected row and where the key
 * came from, nothing else.
 *
 * F3 follows the same rule (it was the PDF's find from anywhere but the
 * list, and the Explorer's search from the list).
 *
 * Returns `route(e)` for the keys the Explorer's own onKeyDown hears (Ctrl+F,
 * and F3 from the list), and listens on `window` for the rest: the preview
 * pane (the App's viewer box, a sibling of the Explorer), the page itself
 * (body: a click on a picture moves no focus) and the window's other chrome.
 * The preview's viewers leave a find key pressed outside the preview to this
 * (`yieldsFindToExplorer`), so no listener's order or an earlier popup decides
 * it: before, an Escape out of the search could leave the key to whichever
 * viewer's window listener heard it.
 *
 * "From the preview" is the focus inside it, or, with the focus nowhere, the
 * last press having been in it ("or you just clicked the preview part").
 */
export function useFindRoute(
  shell: RefObject<HTMLElement | null>,
  selection: FindSelection,
  openSearch: () => void
): (e: FindKeyEvent) => void {
  const pressedPreview = useRef(false)
  const route = (e: FindKeyEvent): void => {
    const target = e.target instanceof Element ? e.target : null
    const nowhere = !target || target === document.body || target === document.documentElement
    const from =
      (target && inPreview(target)) || (nowhere && pressedPreview.current) ? 'preview' : 'explorer'
    const surface = previewFindSurface()
    const answer = findRoute({ selection, from, previewFind: !!surface })
    if (answer === 'preview-find') {
      // Pressed inside the preview: its viewer's own listener takes it.
      if (target && inPreview(target)) return
      e.preventDefault()
      e.stopPropagation()
      if (surface) openPreviewFind(surface, e.key === 'F3' ? 'F3' : 'find', e.shiftKey)
      return
    }
    e.preventDefault()
    e.stopPropagation()
    openSearch()
  }
  const latest = useRef(route)
  useEffect(() => {
    latest.current = route
  })

  useEffect(() => {
    const live = (): boolean => {
      const box = shell.current
      return !!box?.isConnected && !box.closest('[inert]') && box.getClientRects().length > 0
    }
    const onPress = (e: PointerEvent): void => {
      pressedPreview.current = e.target instanceof Element && inPreview(e.target)
    }
    const onKey = (e: KeyboardEvent): void => {
      const ctrlF = e.ctrlKey && !e.shiftKey && (e.key === 'f' || e.key === 'F')
      const f3 = !e.ctrlKey && e.key === 'F3'
      if ((!ctrlF && !f3) || e.altKey || e.metaKey) return
      if (e.defaultPrevented || e.repeat || !live()) return
      const el = e.target instanceof Element ? e.target : null
      // Inside the Explorer its own onKeyDown answers; outside the preview a
      // field, an editor, a menu or a dialog keeps its keys.
      if (el && shell.current?.contains(el)) return
      if (el?.closest('[inert]')) return
      if (el && !inPreview(el) && el.closest(`${FIELD},${EDITOR},${OVERLAY}`)) return
      latest.current(e)
    }
    document.addEventListener('pointerdown', onPress, true)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPress, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [shell])

  return route
}
