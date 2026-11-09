import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { OVERLAY } from '../../lib/focusGuards'
import { menuOrDialogUp } from '../../lib/pageDocuments'

const TAB_STRIP = '[role="tablist"]'

/**
 * THE KEYBOARD COMES BACK TO THE LIST (owner, 2026-11-09: "if i click delte
 * agin nothign happens i ahve to click the next file manually"). A question
 * takes the focus to its button, and the button going drops it on the page;
 * the row a delete takes drops it the same way. The list's keys need the focus
 * inside the list, so nothing answered until the next click.
 *
 * Remembered here, by the last press or key: in the list, it is the list's
 * keyboard; on a question or a menu, whatever it was before; anywhere else, it
 * was given up, and a loss after that stays lost. It is put back only when it
 * fell to nothing, in this window, with nothing in front: a field the owner
 * went to, or another window, are never taken from.
 *
 * A PRESS ON A TAB IS A PRESS FOR THE FOLDER IT SHOWS (owner, 2026-11-09: "to
 * get it to work then i have to click into the directory"). The press left the
 * focus on the tab's own button, where the list's keys could not hear it.
 * Reaching the strip by the keyboard is not a press, and keeps it.
 */
export function useListKeyboard(
  shell: RefObject<HTMLElement | null>,
  covered: boolean,
  selectedPath: string | null
): void {
  const home = useRef(true)
  // The list took it with no row to sit on (the selected row had just gone):
  // the row the selection moves to takes it from the list.
  const waiting = useRef(false)
  // The last press was on the tab strip, so its button holds the focus only
  // because the press put it there.
  const pressedTab = useRef(false)
  const bringBack = useRef<() => void>(() => {})
  useEffect(() => {
    const heard = (event: Event): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (event.type === 'keydown' && target === document.body) return
      waiting.current = false
      pressedTab.current =
        event.type === 'pointerdown' &&
        (event as PointerEvent).button === 0 &&
        !!target.closest(TAB_STRIP)
      if (pressedTab.current) {
        home.current = true
        return
      }
      if (target.closest(`${OVERLAY},[data-owns-escape]`)) return
      home.current = !!target.closest('.browse-list')
    }
    // A press on the tab already in front commits nothing, so the effect below
    // would never run for it.
    const clicked = (event: Event): void => {
      if (pressedTab.current && event.target instanceof Element && event.target.closest(TAB_STRIP))
        bringBack.current()
    }
    document.addEventListener('pointerdown', heard, true)
    document.addEventListener('keydown', heard, true)
    document.addEventListener('click', clicked)
    return () => {
      document.removeEventListener('pointerdown', heard, true)
      document.removeEventListener('keydown', heard, true)
      document.removeEventListener('click', clicked)
    }
  }, [])
  // Every commit: the question closing, the row going and the tab changing are
  // all one.
  useLayoutEffect(() => {
    bringBack.current = () => {
      if (!home.current || covered || menuOrDialogUp() || !document.hasFocus()) return
      const list = shell.current?.querySelector<HTMLElement>('.browse-list')
      if (!list) return
      const now = document.activeElement
      const lost = !now || now === document.body || (pressedTab.current && !!now.closest(TAB_STRIP))
      if (!lost && !(waiting.current && now === list)) return
      const row = selectedPath
        ? list.querySelector<HTMLElement>(`[data-browse-path="${CSS.escape(selectedPath)}"]`)
        : null
      waiting.current = !row
      ;(row ?? list).focus({ preventScroll: true })
    }
    bringBack.current()
  })
}
