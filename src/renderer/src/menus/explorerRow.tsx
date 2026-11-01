/**
 * THE EXPLORER LIST ROW MENU: what a right-click on a file or folder row in
 * the Explorer tab's list shows (one row, or several marked ones). Opened by
 * App (`browseMenu`). A row inside an archive gets the archive's own menu
 * instead (`useArchiveActions`), and App only falls back to this one when
 * that answers nothing.
 */
import type { OpenWithApp, ViewerFile } from '@shared/types'
import { COPY_FORMATS, canCopyImage, type CopyFormat } from '@shared/imageCopy'
import type { MenuItem } from '../components/ContextMenu'
import { FileMenuIcon } from '../components/icons/FileMenuIcon'
import type { BrowseEntry } from '../components/browse/types'
import { browseParent } from '../lib/browse'
import type { QuickAccessPin } from '../lib/quickAccess'
import { fileAppMenu } from './fileAppMenu'
import { fileVerbs } from './fileVerbs'

export interface ExplorerRowMenuContext {
  /** The row the press was on. */
  entry: BrowseEntry
  /** Several marked rows, when the press was on one of them (#257). */
  paths?: string[]
  /** Whether the clipboard holds files (asked when the menu opens). */
  canPaste?: boolean
  /** The apps that open the file: null while still looking, undefined for a
   *  folder. */
  apps?: OpenWithApp[] | null
  /** Whether the row is already pinned to Quick access. */
  pinned: boolean
  openFolder: (path: string) => void
  openFile: (file: ViewerFile) => void
  showInPreview: (path: string) => void
  openInNewTab: (path: string, isFolder: boolean) => void
  copyFiles: (paths: string[], cut?: boolean) => void
  paste: (directory: string) => void
  pinQuickAccess: (pins: QuickAccessPin[]) => void
  unpinQuickAccess: (path: string) => void
  duplicate: (path: string) => void
  rename: (entry: BrowseEntry) => void
  askDelete: (entry: BrowseEntry) => void
  askDeleteMany: (paths: string[]) => void
  properties: (entry: BrowseEntry) => void
  /** Change icon... (folder icons, 2026-10-31): folders only, one or every
   *  marked one. Absent, the row is not offered. */
  changeIcon?: (paths: string[]) => void
  /** Whether a marked path is a folder: with several marked, Change icon...
   *  is offered only when every one is (D13). */
  isFolder?: (path: string) => boolean
  /** Save copies as (#474): several marked rows. Absent, not offered. */
  saveCopies?: (paths: string[], format: CopyFormat) => void
}

export function explorerRowMenu(ctx: ExplorerRowMenuContext): MenuItem[] {
  const { entry } = ctx
  if (ctx.paths && ctx.paths.length > 1) {
    // Several rows marked: only what acts on all of them, and each
    // says how many, so the menu and the marks agree (review of #257).
    // Open, Rename, Duplicate and Properties are one row's, and F2
    // stands down in the same state.
    const paths = ctx.paths
    const n = `${paths.length} items`
    return [
      {
        label: `Cut ${n}`,
        icon: <FileMenuIcon name="cut" />,
        hint: 'Ctrl+X',
        onPick: () => ctx.copyFiles(paths, true)
      },
      {
        label: `Copy ${n}`,
        icon: <FileMenuIcon name="copy" />,
        hint: 'Ctrl+C',
        onPick: () => ctx.copyFiles(paths)
      },
      ...(ctx.changeIcon && ctx.isFolder && paths.every((p) => ctx.isFolder?.(p))
        ? [
            {
              label: `Change icon for ${paths.length} folders...`,
              icon: <FileMenuIcon name="icon" />,
              onPick: () => ctx.changeIcon?.(paths)
            }
          ]
        : []),
      // SAVE COPIES AS (#474; owner, 2026-11-01): many pictures saved as
      // another format in one job, each copy next to its original. Offered
      // when at least one marked row is a picture; every path goes, and main
      // skips (and counts) the rest. The single picture's "Save a copy" has
      // the same five formats.
      ...(ctx.saveCopies && paths.some((p) => !ctx.isFolder?.(p) && canCopyImage(p))
        ? [
            {
              label: 'Save copies as',
              icon: <FileMenuIcon name="save" />,
              children: COPY_FORMATS.map((f) => ({
                label: f.label,
                icon: <FileMenuIcon name="image" />,
                onPick: () => ctx.saveCopies?.(paths, f.format)
              }))
            }
          ]
        : []),
      {
        label: `Delete ${n}`,
        icon: <FileMenuIcon name="delete" />,
        hint: 'Del',
        danger: true,
        onPick: () => ctx.askDeleteMany(paths)
      }
    ]
  }
  const rows: MenuItem[] = [
    // THE ORDER (owner, 2026-10-12): opening, then the clipboard rows
    // together (Cut, Copy, Copy path, Paste), then what changes the item,
    // then where it is and its facts, and Delete always LAST.
    {
      label: 'Open',
      icon: <FileMenuIcon name="open" />,
      hint: 'Enter',
      onPick: () => {
        if (entry.isFolder) ctx.openFolder(entry.path)
        else if (entry.file) ctx.openFile(entry.file)
      }
    },
    ...(!entry.isFolder
      ? [
          {
            label: 'Show in preview',
            icon: <FileMenuIcon name="split" />,
            onPick: () => ctx.showInPreview(entry.path)
          }
        ]
      : []),
    {
      label: 'Open in new tab',
      icon: <FileMenuIcon name="new-tab" />,
      onPick: () => ctx.openInNewTab(entry.path, entry.isFolder)
    },
    // A file opens in another app.
    ...(entry.isFolder ? [] : [fileAppMenu(entry.path, ctx.apps ?? null)]),
    {
      label: 'Cut',
      icon: <FileMenuIcon name="cut" />,
      hint: 'Ctrl+X',
      onPick: () => ctx.copyFiles([entry.path], true)
    },
    {
      label: 'Copy',
      icon: <FileMenuIcon name="copy" />,
      hint: 'Ctrl+C',
      onPick: () => ctx.copyFiles([entry.path])
    },
    // Copy path right under Copy (#286; owner, 2026-10-04: "copy and
    // copy path should be right under each other not spread out
    // across the menu"). Show in File Explorer stays below, by Properties.
    ...fileVerbs(entry.path)
      .filter((item) => item.label === 'Copy path')
      .map((item) => ({ ...item, icon: <FileMenuIcon name="path" /> })),
    {
      label: 'Paste',
      icon: <FileMenuIcon name="paste" />,
      hint: 'Ctrl+V',
      disabled: !ctx.canPaste,
      onPick: () => {
        const directory = entry.isFolder ? entry.path : browseParent(entry.path)
        if (directory) ctx.paste(directory)
      }
    },
    {
      label: ctx.pinned ? 'Unpin from Quick access' : 'Pin to Quick access',
      icon: <FileMenuIcon name={ctx.pinned ? 'unpin' : 'pin'} />,
      onPick: () => {
        if (ctx.pinned) ctx.unpinQuickAccess(entry.path)
        else ctx.pinQuickAccess([{ path: entry.path, label: entry.name, isFolder: entry.isFolder }])
      }
    },
    // After the pin row (D10): a folder's own icon, Prism's only.
    ...(entry.isFolder && ctx.changeIcon
      ? [
          {
            label: 'Change icon...',
            icon: <FileMenuIcon name="icon" />,
            onPick: () => ctx.changeIcon?.([entry.path])
          }
        ]
      : []),
    ...(!entry.isFolder
      ? [
          {
            label: 'Duplicate',
            icon: <FileMenuIcon name="duplicate" />,
            onPick: () => ctx.duplicate(entry.path)
          }
        ]
      : []),
    {
      label: 'Rename',
      icon: <FileMenuIcon name="rename" />,
      hint: 'F2',
      onPick: () => ctx.rename(entry)
    },
    ...fileVerbs(entry.path)
      .filter((item) => item.label !== 'Copy path')
      .map((item) => ({ ...item, icon: <FileMenuIcon name="folder" /> })),
    {
      label: 'Properties',
      icon: <FileMenuIcon name="properties" />,
      onPick: () => ctx.properties(entry)
    },
    {
      label: 'Delete',
      icon: <FileMenuIcon name="delete" />,
      hint: 'Del',
      danger: true,
      onPick: () => ctx.askDelete(entry)
    }
  ]
  return rows
}
