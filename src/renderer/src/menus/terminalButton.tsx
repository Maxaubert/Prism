import type { MenuItem } from '../components/ContextMenu'
import { FileMenuIcon } from '../components/FileMenuIcon'
import { tickIf } from './fileVerbs'
import { menuIcon } from './treeRow'

/**
 * THE TERMINAL BUTTON'S MENU: what the sidebar footer's Terminal button shows
 * when you right-click it (opened from `Sidebar.tsx`). It is about the tab's
 * shells, not a path, so it has its own small state there.
 */

/** One of the tab's shells, as the button's menu lists it. */
export interface TermEntry {
  id: string
  label: string
  /** The most recent one: the button's left click opens it. */
  current: boolean
  /** On screen in the split. */
  shown: boolean
}

export interface TerminalButtonMenuContext {
  /** The tab's shells (2026-09-03); listed when there are several. */
  terms: TermEntry[]
  pickTerm: (id: string) => void
  newTerm: () => void
  /** Several shells: add one to the split, or take it out. */
  splitTermId: (id: string) => void
  /** One shell: put it in the split. */
  termSplit: () => void
  /** Several shells: kill one of them. */
  closeTermId: (id: string) => void
  /** Kill the shell for good; null when there is none. */
  closeTerm: (() => void) | null
}

export function terminalButtonMenu(ctx: TerminalButtonMenuContext): MenuItem[] {
  const { terms } = ctx
  return [
    // SEVERAL SHELLS (owner, 2026-09-03): with more than one, the
    // menu lists them to pick from (the current one ticked; the
    // button's left click always opens the most recent), and the
    // verbs that need a target - split, close - become submenus so
    // the menu itself stays short.
    ...(terms.length > 1
      ? terms.map((t) => ({
          label: t.label,
          icon: tickIf(t.current),
          onPick: () => ctx.pickTerm(t.id)
        }))
      : []),
    {
      label: 'Open new terminal',
      // A window with a prompt in it (owner, 2026-09-03: not the plus).
      icon: menuIcon('M4 5.5h16v13H4zM4 9h16M7.5 12l2.5 2-2.5 2M12 16h4'),
      onPick: ctx.newTerm
    },
    terms.length > 1
      ? {
          label: 'Open in split view',
          icon: <FileMenuIcon name="split" />,
          // A CHECKLIST (owner, 2026-09-03): a shell already on screen
          // is ticked, so it is plain which others to add; picking a
          // ticked one takes it out of the split again.
          children: terms.map((t) => ({
            label: t.label,
            icon: tickIf(t.shown),
            keepOpen: true, // tick several, or change your mind (owner)
            onPick: () => ctx.splitTermId(t.id)
          }))
        }
      : {
          label: 'Open in split view',
          icon: <FileMenuIcon name="split" />,
          onPick: ctx.termSplit
        },
    // CLOSE means close (owner, 2026-09-03): the shell dies, and the
    // next open is a fresh one in the tab's current folder. It took
    // Clear's place and Clear's bin glyph (owner, same day) - a fresh
    // shell IS a cleared one - and it is not red: closing a shell is
    // routine, not destructive. "Open in new tab" went with it.
    ...(terms.length > 1
      ? [
          {
            label: 'Close terminal',
            icon: menuIcon('M5 7h14M9 7V5h6v2M7 7l1 12h8l1-12M10 11v5M14 11v5'),
            children: terms.map((t) => ({ label: t.label, onPick: () => ctx.closeTermId(t.id) }))
          }
        ]
      : ctx.closeTerm
        ? [
            {
              label: 'Close terminal',
              icon: menuIcon('M5 7h14M9 7V5h6v2M7 7l1 12h8l1-12M10 11v5M14 11v5'),
              onPick: ctx.closeTerm
            }
          ]
        : [])
  ]
}
