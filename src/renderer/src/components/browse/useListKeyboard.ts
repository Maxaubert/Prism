import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { OVERLAY } from '../../lib/focusGuards'
import { menuOrDialogUp } from '../../lib/pageDocuments'

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
  useEffect(() => {
    const heard = (event: Event): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (event.type === 'keydown' && target === document.body) return
      waiting.current = false
      if (target.closest(`${OVERLAY},[data-owns-escape]`)) return
      home.current = !!target.closest('.browse-list')
    }
    document.addEventListener('pointerdown', heard, true)
    document.addEventListener('keydown', heard, true)
    return () => {
      document.removeEventListener('pointerdown', heard, true)
      document.removeEventListener('keydown', heard, true)
    }
  }, [])
  // Every commit: the question closing and the row going are both one.
  useLayoutEffect(() => {
    if (!home.current || covered || menuOrDialogUp() || !document.hasFocus()) return
    const list = shell.current?.querySelector<HTMLElement>('.browse-list')
    if (!list) return
    const now = document.activeElement
    const lost = !now || now === document.body
    if (!lost && !(waiting.current && now === list)) return
    const row = selectedPath
      ? list.querySelector<HTMLElement>(`[data-browse-path="${CSS.escape(selectedPath)}"]`)
      : null
    waiting.current = !row
    ;(row ?? list).focus({ preventScroll: true })
  })
}
