/**
 * The archive viewer's menus: what you get right-clicking inside the member
 * panel of an opened archive (ArchiveView): a file member's row, a folder
 * member's row, a row among several marked, and the panel's empty space.
 *
 * Not the archive menus of the Explorer and the project tree, where a zip
 * browses as an ordinary folder: those are menus/archiveMenus.
 */
import type { MenuItem } from '../../components/ContextMenu'
import { copyFilePaths } from '../../lib/fileClipboard'

/** What a member row needs to be for its menu: where it is and whether it is a folder. */
export interface ArchiveMember {
  path: string
  dir: boolean
}

/** What the host can do (window.prism.capabilities, as the viewer holds it). */
export interface ArchiveCaps {
  clipboard: boolean
  write: boolean
  explorer: boolean
}

export interface ArchiveRowMenuContext<E extends ArchiveMember> {
  /** The row right-clicked. */
  entry: E
  /** Every marked path, when the row was one of several marked. */
  multi?: string[]
  caps: Pick<ArchiveCaps, 'clipboard' | 'write'>
  /** The ARCHIVE can be changed: the host writes and the container is not read-only. */
  writable: boolean
  /** Every FILE member inside a folder, at any depth. */
  membersUnder: (folder: string) => string[]
  /** The file members among the given paths (a marked folder is carried by its members). */
  filesOf: (paths: string[]) => string[]
  setCwd: (folder: string) => void
  view: (entry: E) => void
  copyOut: (entry: E) => void
  copyFolder: (folder: string) => void
  copyMany: (paths: string[]) => void
  extractFolderHere: (folder: string) => void
  extractMembers: (entry: E, entries: string[], here: boolean) => void
  /** Starts a rename of the member in place. */
  setEditing: (path: string) => void
  /** Asks before deleting one member. */
  setConfirmDel: (entry: E) => void
  /** Asks before deleting several members. */
  setConfirmDelMany: (paths: string[]) => void
}

/**
 * A FOLDER row's menu (2026-08-30).
 *
 * Right-clicking one used to open nothing at all, which reads as a broken
 * app rather than as a limit. Its verbs are the ones that mean something for
 * a prefix: walk into it, copy out everything under it, delete all of that.
 * No rename: renaming a folder inside a zip means rewriting every member
 * path under it, and that is a decision, not a gap to be filled here.
 */
function folderItems<E extends ArchiveMember>(ctx: ArchiveRowMenuContext<E>): MenuItem[] {
  const { entry, caps, writable } = ctx
  const members = ctx.membersUnder(entry.path)
  const n = members.length
  const items: MenuItem[] = [
    { label: 'Open', onPick: () => ctx.setCwd(entry.path) },
    // The folder itself, not the files that happen to be in it.
    ...(caps.clipboard
      ? [{ label: 'Copy folder', disabled: n === 0, onPick: () => ctx.copyFolder(entry.path) }]
      : []),
    ...(caps.write
      ? [
          {
            label: 'Extract folder here',
            disabled: n === 0,
            onPick: () => ctx.extractFolderHere(entry.path)
          },
          {
            label: 'Extract folder to…',
            disabled: n === 0,
            // The FOLDER, not the files inside it (2026-09-19, found by
            // #166's e2e). Handing over each member's own path made every
            // one of them its own landing, and the landing rule drops the
            // parents above what was asked for: "Collection/sub/two.txt"
            // arrived as a bare "two.txt", so the verb that says "folder"
            // delivered a flat pile, which is the very thing Copy folder
            // was fixed for on 2026-08-31. Named as one entry, the shape
            // below it is kept, exactly as a dragged folder's is.
            onPick: () => ctx.extractMembers(entry, [entry.path], false)
          }
        ]
      : []),
    ...(caps.clipboard
      ? [
          {
            label: `Copy ${n} file${n === 1 ? '' : 's'} inside`,
            disabled: n === 0,
            onPick: () => ctx.copyMany(members)
          }
        ]
      : [])
  ]
  if (writable)
    items.push({
      label: `Delete ${n} file${n === 1 ? '' : 's'} from archive`,
      danger: true,
      disabled: n === 0,
      onPick: () => ctx.setConfirmDelMany(members)
    })
  return items
}

/** A FILE row's menu. */
function fileItems<E extends ArchiveMember>(ctx: ArchiveRowMenuContext<E>): MenuItem[] {
  const { entry, caps, writable } = ctx
  return [
    { label: 'View', onPick: () => ctx.view(entry) },
    ...(caps.clipboard ? [{ label: 'Copy file', onPick: () => ctx.copyOut(entry) }] : []),
    ...(caps.write
      ? [
          {
            label: 'Extract here',
            onPick: () => ctx.extractMembers(entry, [entry.path], true)
          },
          {
            label: 'Extract to…',
            onPick: () => ctx.extractMembers(entry, [entry.path], false)
          }
        ]
      : []),
    ...(writable
      ? [
          { label: 'Rename', hint: 'F2', onPick: () => ctx.setEditing(entry.path) },
          {
            label: 'Delete from archive',
            danger: true,
            onPick: () => ctx.setConfirmDel(entry)
          }
        ]
      : [])
  ]
}

/** Empty when the host can do nothing with several at once, and the row's
 *  own menu stands in for it. */
function multiItems<E extends ArchiveMember>(
  ctx: ArchiveRowMenuContext<E>,
  paths: string[]
): MenuItem[] {
  const files = ctx.filesOf(paths)
  return [
    ...(ctx.caps.clipboard
      ? [
          {
            label: `Copy ${files.length} file${files.length === 1 ? '' : 's'}`,
            onPick: () => ctx.copyMany(files)
          }
        ]
      : []),
    ...(ctx.writable
      ? [
          {
            label: `Delete ${files.length} from archive`,
            danger: true,
            disabled: !files.length,
            onPick: () => ctx.setConfirmDelMany(files)
          }
        ]
      : [])
  ]
}

/**
 * A member row's menu: the several-marked menu when the row was one of
 * several marked and the host can act on several, otherwise the folder's or
 * the file's own.
 */
export function archiveRowMenu<E extends ArchiveMember>(ctx: ArchiveRowMenuContext<E>): MenuItem[] {
  if (ctx.multi && multiItems(ctx, ctx.multi).length) return multiItems(ctx, ctx.multi)
  return ctx.entry.dir ? folderItems(ctx) : fileItems(ctx)
}

export interface ArchivePanelMenuContext {
  /** The archive file itself. */
  archivePath: string
  caps: ArchiveCaps
  /** The ARCHIVE can be changed: the host writes and the container is not read-only. */
  writable: boolean
  /** A copy-out or an add is under way. */
  busy: boolean
  /** The folder on show has rows to select. */
  hasRows: boolean
  extractAll: (here?: boolean) => void
  addFiles: () => void
  selectAll: () => void
}

/**
 * The panel's DEAD SPACE (2026-08-30): the whole archive's verbs, where the
 * pointer is, plus Select all.
 */
export function archivePanelMenu(ctx: ArchivePanelMenuContext): MenuItem[] {
  const { archivePath, caps, writable, busy } = ctx
  return [
    ...(caps.write
      ? [
          {
            label: 'Extract all…',
            disabled: busy,
            onPick: () => void ctx.extractAll()
          }
        ]
      : []),
    ...(writable
      ? [{ label: 'Add files…', disabled: busy, onPick: () => void ctx.addFiles() }]
      : []),
    {
      label: 'Select all',
      hint: 'Ctrl+A',
      disabled: !ctx.hasRows,
      onPick: () => ctx.selectAll()
    },
    ...(caps.write
      ? [
          {
            label: 'Extract here',
            disabled: busy,
            onPick: () => ctx.extractAll(true)
          },
          {
            label: 'Extract to…',
            disabled: busy,
            onPick: () => ctx.extractAll(false)
          }
        ]
      : []),
    ...(caps.clipboard
      ? [
          {
            label: 'Copy archive',
            onPick: () => void copyFilePaths([archivePath])
          }
        ]
      : []),
    ...(caps.explorer
      ? [
          {
            label: 'Show in File Explorer',
            onPick: () => window.prism.showInExplorer(archivePath)
          }
        ]
      : []),
    { label: 'Copy path', onPick: () => void navigator.clipboard.writeText(archivePath) }
  ]
}
