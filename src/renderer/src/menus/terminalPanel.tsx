import type { MenuItem } from '../components/ContextMenu'
import type { DockEdge } from '../lib/termDock'
import { tickIf } from '../components/icons/menuGlyphs'

/**
 * THE TERMINAL PANEL'S MENU: what the user right-clicks inside a tab's
 * terminal (`components/TermDock.tsx`), in full view and in split view. Full
 * view gets one too (2026-08-30): Paste means something in both, and that is
 * what a right-click in a terminal is for. The split rows wait for split view,
 * where an edge means something.
 */

// Under a "Split view position" parent (owner, 2026-09-03: a submenu, so the
// menu does not bloat), so the labels are bare edges.
const EDGE_NAMES: Array<{ edge: DockEdge; label: string }> = [
  { edge: 'left', label: 'Left' },
  { edge: 'right', label: 'Right' },
  { edge: 'top', label: 'Top' },
  { edge: 'bottom', label: 'Bottom' }
]

export interface TerminalPanelMenuContext {
  /** The terminal IS the view: no split rows. */
  full: boolean
  /** The edge the split docks to, ticked under "Split view position". */
  edge: DockEdge
  /** The link under the pointer when the menu opened, if any (#210). */
  link: string | null
  /** What was selected when the menu opened ('' for nothing). */
  selection: string
  /** Copies exactly (the core's copyText, which raises the "Copied" badge). */
  onCopy: (text: string) => unknown
  /** The terminal's OWN paste (the core's pasteInto for this session). */
  onPaste: () => unknown
  onFind: (open: boolean) => void
  onDockPick: (edge: DockEdge) => void
  /** Hide the pane, leaving the file the room. */
  onRemoveFromSplit: () => void
  /** Close the terminal for real: the shell dies. */
  onKill: () => void
}

export function terminalPanelMenu(ctx: TerminalPanelMenuContext): MenuItem[] {
  const { link, selection } = ctx
  return [
    // THE MENU FITS WHAT WAS CLICKED (#210; owner, 2026-09-23, asked in
    // Prism Terminal and agreed for Prism: "if i click it on a link it
    // shows copy link, if i click it with text marked it says copy").
    // Both copy exactly through the core's copyText, which raises the
    // "Copied" badge once the clipboard has it (#215).
    ...(link ? [{ label: 'Copy link', onPick: () => void ctx.onCopy(link) }] : []),
    ...(selection
      ? [{ label: 'Copy', hint: 'Ctrl+C', onPick: () => void ctx.onCopy(selection) }]
      : []),
    {
      label: 'Paste',
      // Through the terminal's OWN paste (lib/termBus), which is
      // bracketed for text and forwards the ^V keystroke for an image
      // so the TUI can read the clipboard itself. Writing the text
      // straight to the pty instead would send a multi-line paste as
      // a run of Enter presses: the first line runs and the rest are
      // typed in after it.
      onPick: () => void ctx.onPaste()
    },
    { label: 'Find', hint: 'Ctrl+Shift+F', onPick: () => ctx.onFind(true) },
    // The core's popup: find a command by describing it, then copy it.
    ...(ctx.full
      ? []
      : ([
          {
            label: 'Split view position',
            children: EDGE_NAMES.map((it) => ({
              label: it.label,
              icon: tickIf(it.edge === ctx.edge),
              onPick: () => ctx.onDockPick(it.edge)
            }))
          },
          { label: 'Remove from split view', onPick: ctx.onRemoveFromSplit }
        ] as MenuItem[])),
    // CLOSE means close (owner, 2026-09-03): the shell dies here, and
    // the next open is a fresh one in the tab's current folder.
    { label: 'Close terminal', onPick: ctx.onKill }
  ]
}
