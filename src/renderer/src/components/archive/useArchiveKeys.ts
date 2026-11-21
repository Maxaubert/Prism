import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { parentDir } from '@shared/path'
import { isTypingTarget } from '../../lib/focusGuards'
import type { Selection } from '../../lib/selection'
import type { OpenMember } from './useArchiveVerbs'

// THE ARCHIVE PANEL'S KEYS (out of ArchiveView.tsx, audit #31, unchanged):
// Escape closes the member preview, Backspace climbs out of a folder, Ctrl+A
// marks the folder's rows.

export function useArchiveKeys({
  member,
  setMember,
  memberBox,
  cwd,
  setCwd,
  editing,
  opsOpen,
  order,
  hasFocus,
  setSel
}: {
  member: OpenMember | null
  setMember: (m: OpenMember | null) => void
  /** The member overlay, so Escape can tell whether a DEEPER one is inside it. */
  memberBox: RefObject<HTMLDivElement | null>
  cwd: string
  setCwd: (path: string) => void
  editing: string | null
  /** A question or notice of useArchiveOps is up. */
  opsOpen: boolean
  /** The paths of the rows in view, in order. */
  order: string[]
  /** Whether the panel is the surface last touched (useBandSelect). */
  hasFocus: RefObject<boolean>
  setSel: Dispatch<SetStateAction<Selection>>
}): void {
  // Escape closes the member preview; Backspace climbs out of a folder.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (member && e.key === 'Escape') {
        // A nested archive puts a second overlay INSIDE this one, and both
        // handlers sit on the window, so an unguarded Escape closed this level
        // and its parent at once - out of a file, out of the archive holding
        // it, in one press. Whichever overlay has no deeper one inside it is
        // the one that answers, which is the same `data-owns-escape` contract
        // App already yields on.
        if (memberBox.current?.querySelector('[data-owns-escape]')) return
        e.stopPropagation()
        setMember(null)
      } else if (!member && e.key === 'Backspace' && cwd && !editing && !opsOpen) {
        const el = document.activeElement
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
        e.preventDefault()
        setCwd(parentDir(cwd))
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [member, cwd, editing, opsOpen, setCwd, setMember, memberBox])

  /** Ctrl+A marks everything in the folder you are looking at - this folder,
   *  not the whole archive, which is what Explorer means by it too. Only
   *  while the panel is the surface you last touched, and never while
   *  something is being typed into. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.shiftKey || e.altKey || (e.key !== 'a' && e.key !== 'A')) return
      if (!hasFocus.current || member) return
      const el = e.target as HTMLElement | null
      if (isTypingTarget(el)) return
      // The keyboard went on to the Explorer's list since the last press
      // here (Tab): its own Ctrl+A answers (#330), not both.
      if (el?.closest('.browse-list')) return
      e.preventDefault()
      setSel({ anchor: order[0] ?? null, items: new Set(order) })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [order, member, hasFocus, setSel])
}
