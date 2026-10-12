import type { JSX } from 'react'
import type { OpenWithApp } from '@shared/types'
import type { MenuItem } from '../components/ContextMenu'
import { FileMenuIcon } from '../components/FileMenuIcon'
import { fileAppMenu } from './fileAppMenu'
import { lastSplitDir, type SplitDir } from '../lib/panes'
import { baseName, parentDir } from '@shared/path'
import { formatBytes } from '../lib/format'

/**
 * THE PROJECT TREE'S MENUS: what the sidebar's file tree shows when you
 * right-click it. Three surfaces, all opened from `Sidebar.tsx`: a single row
 * (file or folder), several marked rows, and the dead space under the rows.
 *
 * A row INSIDE an archive is not here: its menu is the archive's own
 * (`useArchiveActions`, rows from `archiveMenus.ts`).
 *
 * The component keeps the state and the handlers; these only say which rows
 * show, in what order, and which handler each one calls.
 */

/** Menu glyphs: outlined, so they read as actions rather than as file kinds. */
export const menuIcon = (d: string): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    width={13}
    height={13}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="opacity-80"
    aria-hidden
  >
    <path d={d} />
  </svg>
)

/** The panel's dead space: the root folder, nothing else under the cursor. */
export interface TreeDeadSpaceMenuContext {
  /** The tab's root folder, which every row here acts on. */
  root: string
  /** Paste the clipboard's files into a folder. */
  paste: (dest: string) => void | Promise<void>
  /** Spawn a shell in a folder. */
  termHere: (folder: string) => void
  /** The root folder's facts (owner, 2026-10-12: folders get Properties). */
  showProperties: (target: { path: string; name: string; isFolder: boolean }) => void
}

export function treeDeadSpaceMenu(ctx: TreeDeadSpaceMenuContext): MenuItem[] {
  const { root } = ctx
  return [
    {
      label: 'Paste',
      hint: 'Ctrl+V',
      icon: <FileMenuIcon name="paste" />,
      onPick: () => ctx.paste(root)
    },
    {
      label: 'Copy path',
      icon: <FileMenuIcon name="path" />,
      onPick: () => void navigator.clipboard.writeText(root)
    },
    {
      label: 'New terminal here',
      icon: <FileMenuIcon name="terminal" />,
      onPick: () => ctx.termHere(root)
    },
    {
      label: 'Show in File Explorer',
      icon: <FileMenuIcon name="folder" />,
      onPick: () => window.prism.showInExplorer(root)
    },
    {
      label: 'Properties',
      icon: <FileMenuIcon name="properties" />,
      onPick: () => ctx.showProperties({ path: root, name: baseName(root), isFolder: true })
    }
  ]
}

/** Several marked rows, right-clicked inside the marking. */
export interface TreeMarkedMenuContext {
  /** Every marked path; the menu acts on all of them. */
  paths: string[]
  /** Put the paths on the file clipboard, as a cut or a copy. */
  copyMark: (paths: string[], cut: boolean) => void
  /** One question, then every path to the bin. */
  deleteMany: (paths: string[]) => void
}

/** A multi-selection's menu: the verbs that make sense N at a time. */
export function treeMarkedMenu(ctx: TreeMarkedMenuContext): MenuItem[] {
  const { paths } = ctx
  return [
    {
      label: `Cut ${paths.length} files`,
      hint: 'Ctrl+X',
      icon: <FileMenuIcon name="cut" />,
      onPick: () => ctx.copyMark(paths, true)
    },
    {
      label: `Copy ${paths.length} files`,
      hint: 'Ctrl+C',
      icon: <FileMenuIcon name="copy" />,
      onPick: () => ctx.copyMark(paths, false)
    },
    {
      label: 'Copy paths',
      icon: <FileMenuIcon name="path" />,
      onPick: () => void navigator.clipboard.writeText(paths.join('\n'))
    },
    {
      label: `Delete ${paths.length} items`,
      hint: 'Del',
      danger: true,
      icon: <FileMenuIcon name="delete" />,
      onPick: () => ctx.deleteMany(paths)
    }
  ]
}

/** One row of the tree, a file or a folder, outside any archive. */
export interface TreeRowMenuContext {
  path: string
  name: string
  isFolder: boolean
  /** Bytes on disk, for the Properties row's hint. Folders carry none. */
  size?: number
  /** "Open in" candidates: undefined for folders, null while they load. */
  apps?: OpenWithApp[] | null
  /** The archive verbs, for a row that is one: undefined when the row is not
   *  an archive, null while the stat is in flight. */
  arc?: { write: boolean } | null
  /** Whether the clipboard holds files; undefined while the answer is in
   *  flight, and the Paste row appears when it lands. */
  canPaste?: boolean
  /** Paths currently pinned as split panes: their menu offers the way OUT. */
  pinnedPaths: readonly string[]
  /** A search is showing: Open on a folder reveals it in the tree. */
  searching: boolean
  /** The folder is already expanded, so Open has nothing to do. */
  expanded: boolean
  /** Leave the search and put the folder on screen in the tree. */
  revealFolder: (path: string) => void
  /** Expand or collapse a folder. */
  toggle: (path: string) => void
  /** Open a file the way picking its row would. */
  openFile: (path: string) => void
  onOpenNewTab: (path: string) => void
  onOpenProject: (path: string, isFolder: boolean) => void
  /** Pin a file as a split pane; no direction means the remembered one. */
  pinSplit: (path: string, dir?: SplitDir) => void
  unpinSplit: (path: string) => void
  copyMark: (paths: string[], cut: boolean) => void
  paste: (dest: string) => void | Promise<void>
  termHere: (folder: string) => void
  /** Extract an archive, here (no dialog) or to a folder main asks for. */
  extract: (path: string, here: boolean) => void
  addToArchive: (path: string, name: string) => void
  /** A copy was made: the source and the copy, for undo. */
  onDuplicated: (source: string, copyPath: string) => void
  /** Re-read a folder after a change landed in it. */
  reload: (dir: string) => void | Promise<void>
  /** Start the inline rename on the row. */
  rename: (path: string) => void
  showProperties: (target: { path: string; name: string; isFolder: boolean; size?: number }) => void
  onDelete: (path: string, name: string, isFolder: boolean) => void
}

export function treeRowMenu(ctx: TreeRowMenuContext): MenuItem[] {
  const { path, name, isFolder } = ctx
  return [
    // Same order as the Explorer's row menu (explorerRow.tsx; owner,
    // 2026-10-12): opening, the clipboard rows together, what changes the
    // item, where it is and its facts, Delete LAST.
    {
      label: 'Open',
      hint: 'Enter',
      icon: <FileMenuIcon name="open" />,
      onPick: () => {
        if (isFolder) {
          if (ctx.searching) ctx.revealFolder(path)
          else if (!ctx.expanded) ctx.toggle(path)
        } else ctx.openFile(path)
      }
    },
    {
      label: 'Open in new tab',
      icon: <FileMenuIcon name="new-tab" />,
      onPick: () => ctx.onOpenNewTab(path)
    },
    {
      label: 'Open as project',
      icon: <FileMenuIcon name="project" />,
      onPick: () => ctx.onOpenProject(path, isFolder)
    },
    // Files also go places: another app, Explorer, the clipboard.
    ...(!isFolder
      ? [
          // Split panes are file-agnostic: pin any file beside the
          // live one. The parent click reuses the remembered
          // direction; the flyout names one. A pinned file's menu
          // offers the way back out instead.
          ctx.pinnedPaths.some((pp) => pp.toLowerCase() === path.toLowerCase())
            ? {
                label: 'Remove from split view',
                icon: menuIcon('M4 5h16v14H4zM13 5v14M6.5 10.5l2 1.5-2 1.5'),
                onPick: () => ctx.unpinSplit(path)
              }
            : {
                label: 'Open in split view',
                icon: <FileMenuIcon name="split" />,
                onPick: () => ctx.pinSplit(path),
                // The remembered direction wears a check: it is where a
                // bare click on the parent will put the file.
                children: (['left', 'right', 'top', 'bottom'] as const).map((d) => ({
                  label: d[0].toUpperCase() + d.slice(1),
                  icon:
                    d === lastSplitDir() ? (
                      menuIcon('M5 12.5l4.5 4.5L19 7')
                    ) : (
                      <span className="w-[13px] shrink-0" aria-hidden />
                    ),
                  onPick: () => ctx.pinSplit(path, d)
                }))
              },
          fileAppMenu(path, ctx.apps)
        ]
      : []),
    ...(isFolder
      ? [
          {
            label: 'New terminal here',
            icon: <FileMenuIcon name="terminal" />,
            onPick: () => ctx.termHere(path)
          }
        ]
      : []),
    {
      label: 'Cut',
      hint: 'Ctrl+X',
      icon: <FileMenuIcon name="cut" />,
      onPick: () => ctx.copyMark([path], true)
    },
    {
      label: 'Copy',
      hint: 'Ctrl+C',
      icon: <FileMenuIcon name="copy" />,
      onPick: () => ctx.copyMark([path], false)
    },
    {
      label: 'Copy path',
      icon: <FileMenuIcon name="path" />,
      onPick: () => void navigator.clipboard.writeText(path)
    },
    ...(ctx.canPaste
      ? [
          {
            /**
             * PASTE ON A ROW, not only on the panel's dead space
             * (2026-09-02). A full folder has no dead space to
             * right-click, and reaching for the one strip that is left
             * pasted into the ROOT rather than where you were looking.
             *
             * A FOLDER row takes it; a FILE row means its folder, which
             * is what "paste here" means when the thing under the
             * cursor is a file. With the other clipboard rows, and
             * drawn only when the clipboard actually holds files.
             */
            label: 'Paste',
            hint: 'Ctrl+V',
            icon: <FileMenuIcon name="paste" />,
            onPick: () => ctx.paste(isFolder ? path : parentDir(path))
          }
        ]
      : []),
    ...(ctx.arc !== undefined
      ? [
          {
            // "Extract here" needs no dialog: the archive's own folder
            // is already inside a root, so there is nothing to consent
            // to. "Extract to…" keeps main's dialog, which IS the
            // consent that lets it write anywhere. Same pair, and the
            // same reasoning, as the archive panel's verb row.
            label: 'Extract here',
            icon: menuIcon('M12 4v9m0 0l-3.5-3.5M12 13l3.5-3.5M4.5 16v3.5h15V16'),
            onPick: () => ctx.extract(path, true)
          },
          {
            label: 'Extract to…',
            icon: menuIcon('M12 4v9m0 0l-3.5-3.5M12 13l3.5-3.5M2.5 15.5h6.2l2 2.6h10.8'),
            onPick: () => ctx.extract(path, false)
          },
          ...(ctx.arc?.write
            ? [
                {
                  label: 'Add files…',
                  icon: <FileMenuIcon name="duplicate" />,
                  onPick: () => ctx.addToArchive(path, name)
                }
              ]
            : [])
        ]
      : []),
    ...(!isFolder
      ? [
          {
            label: 'Duplicate',
            icon: <FileMenuIcon name="duplicate" />,
            onPick: () =>
              void window.prism.duplicateFile(path).then((copy) => {
                if (copy) {
                  ctx.onDuplicated(path, copy)
                  void ctx.reload(parentDir(path))
                }
              })
          }
        ]
      : []),
    {
      label: 'Rename',
      hint: 'F2',
      icon: <FileMenuIcon name="rename" />,
      onPick: () => ctx.rename(path)
    },
    {
      label: 'Show in File Explorer',
      icon: <FileMenuIcon name="folder" />,
      onPick: () => window.prism.showInExplorer(path)
    },
    {
      label: 'Properties',
      // The size right on the row: the question Properties answers most.
      hint: isFolder ? undefined : formatBytes(ctx.size ?? NaN) || undefined,
      icon: <FileMenuIcon name="properties" />,
      onPick: () =>
        ctx.showProperties({
          path,
          name,
          isFolder,
          size: ctx.size
        })
    },
    {
      label: 'Delete',
      hint: 'Del',
      danger: true,
      icon: <FileMenuIcon name="delete" />,
      onPick: () => ctx.onDelete(path, name, isFolder)
    }
  ]
}
