import { useEffect, useState, type RefObject } from 'react'

export type ExplorerArea = 'places' | 'main'

/**
 * WHERE THE USER LAST ACTED IN THE EXPLORER (#296; owner, 2026-10-06, of File
 * Explorer's sidebar: "the sidebar item gets fully highlighted when you click
 * it but as soon as you click something in the main view after that it gets
 * dimmed, still highlighted but dimmed"). A press or the keyboard's focus in
 * the places panel makes it 'places'; anywhere else, 'main'. A menu is
 * neither: picking from a place's menu leaves the panel the active one. It
 * starts on 'main', where the list takes the keyboard when the Explorer
 * opens. State, not `:focus-within`: a click on the list's empty space moves
 * no focus, and the e2e runs in a window that never has focus.
 */
export function useActiveArea(shell: RefObject<HTMLElement | null>): ExplorerArea {
  const [area, setArea] = useState<ExplorerArea>('main')
  useEffect(() => {
    const heard = (event: Event): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('[role="menu"]')) return
      const inPlaces = !!target.closest('.browse-places') && !!shell.current?.contains(target)
      setArea(inPlaces ? 'places' : 'main')
    }
    document.addEventListener('pointerdown', heard, true)
    document.addEventListener('focusin', heard, true)
    return () => {
      document.removeEventListener('pointerdown', heard, true)
      document.removeEventListener('focusin', heard, true)
    }
  }, [shell])
  return area
}
