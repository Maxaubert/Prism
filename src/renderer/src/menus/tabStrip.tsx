import type { JSX } from 'react'
import { recentLabels } from 'prism-term-core/renderer/lib/recentRoots'
import type { MenuItem } from '../components/ContextMenu'

/**
 * THE TAB STRIP'S TWO MENUS (`components/TabStrip.tsx`): a tab's own menu,
 * opened by right-clicking anywhere on the tab, and the + button's menu of
 * places Prism has been, opened by right-clicking the + (its left click adds
 * a tab instantly, so the instant verb stays instant).
 */

export interface TabMenuContext {
  /** The tab's folder; '' for a tab with no folder (Settings). */
  root: string
  /** A pinned Explorer tab, which cannot be closed. */
  pinned: boolean
  onClose: () => void
}

/** A tab's own menu. Deliberately WITHOUT 'close others': each close can
 *  raise the unsaved-changes question, and firing several would overwrite
 *  it and lose the work it exists to protect. That wants App-side
 *  batching, which is a decision rather than a gap to fill here. */
export function tabContextMenu(ctx: TabMenuContext): MenuItem[] {
  const { root } = ctx
  return [
    // Every row acts on the tab you clicked. "New tab" was here and
    // went (2026-08-31): the + is one pixel away and its tooltip
    // already teaches Ctrl+T.
    // Settings is a tab with no folder. Offering these there did
    // nothing for one of them and wrote an EMPTY STRING over the
    // clipboard for the other, which is worse than doing nothing.
    ...(root
      ? [
          {
            label: 'Copy folder path',
            onPick: () => void navigator.clipboard.writeText(root)
          },
          {
            label: 'Show folder in File Explorer',
            onPick: () => window.prism.showInExplorer(root)
          }
        ]
      : []),
    // Close LAST, where Delete sits on a file (owner, 2026-10-12).
    ...(!ctx.pinned ? [{ label: 'Close tab', hint: 'Ctrl+W', onPick: ctx.onClose }] : [])
  ]
}

/** The tree's folder, at menu size: the + menu lists PLACES. */
const folderGlyph = (): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    width={13}
    height={13}
    fill="var(--p-tree-folder)"
    className="shrink-0"
    aria-hidden
  >
    <path d="M2.5 5.5h6.2l2 2.6h10.8v10.4H2.5z" />
  </svg>
)

export interface PlusMenuContext {
  /** What the + menu lists, read when it opened: pins first, then the
   *  newest recents. */
  rows: Array<{ path: string; pinned: boolean }>
  onOpenRecent: (path: string) => void
  /** Pins or unpins a folder and re-reads the list while the menu stands. */
  onTogglePin: (path: string) => void
  /** The strip's pin glyph (#99), outlined or filled; the tab wears it too. */
  pinIcon: (filled: boolean) => JSX.Element
}

export function plusButtonMenu(ctx: PlusMenuContext): MenuItem[] {
  const { rows } = ctx
  return rows.length
    ? recentLabels(rows.map((r) => r.path)).map((r, i) => {
        const pinned = rows[i].pinned
        return {
          label: r.label,
          // A folder in front of each, in the tree's own folder
          // colour: the menu should say "places" at a glance, not
          // read as a list of commands.
          icon: folderGlyph(),
          onPick: () => ctx.onOpenRecent(r.path),
          // The pin (#99): toggles in place and the list re-reads,
          // so the row you pinned climbs to the top while the menu
          // stands. Pinned rows stay for good, above the recents.
          trailing: {
            icon: ctx.pinIcon(pinned),
            title: pinned ? 'Unpin' : 'Pin to this menu',
            onClick: () => ctx.onTogglePin(r.path)
          }
        }
      })
    : [{ label: 'No recent folders', disabled: true }]
}
