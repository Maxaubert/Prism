/**
 * The archive viewer's menus: what you get right-clicking inside the member
 * panel of an opened archive (ArchiveView): a file member's row, a folder
 * member's row, a row among several marked, and the panel's empty space.
 *
 * ONE ROW TABLE (#518, owner, 2026-11-19): the rows, their words and their
 * order are `archiveMenuRows`'s, the same table the Explorer's zip menus use
 * (menus/archiveMenus). This file only maps a row id to what the panel does;
 * a row with no handler here (Open in new tab, Properties, Show on a member)
 * or one the host cannot do (no clipboard, no write) is left out.
 */
import type { MenuItem } from '../../components/ContextMenu'
import { canCopyText, clipboardText } from '../../lib/clipboardText'
import { copyFilePaths } from '../../lib/fileClipboard'
import { archiveMenuRows, type ArchiveMenuContext, type ArchiveRowId } from '../archiveMenus'

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

type Handlers = Partial<Record<ArchiveRowId, () => void>>

/** The table's rows for a context, each mapped to its handler; no handler, no row. */
function fromTable(
  context: ArchiveMenuContext,
  handlers: Handlers,
  disabled: (id: ArchiveRowId) => boolean = () => false
): MenuItem[] {
  return archiveMenuRows(context).flatMap((row) => {
    const onPick = handlers[row.id]
    if (!onPick) return []
    return [{ label: row.label, hint: row.hint, danger: row.danger, disabled: disabled(row.id), onPick }]
  })
}

export interface ArchiveRowMenuContext<E extends ArchiveMember> {
  /** The row right-clicked. */
  entry: E
  /** Every marked path, when the row was one of several marked. */
  multi?: string[]
  caps: Pick<ArchiveCaps, 'clipboard' | 'write'>
  /** The ARCHIVE can be changed: the host writes and the container is not read-only. */
  writable: boolean
  /** The archive's file name, for the rows that name it. */
  zip: string
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
  const handlers: Handlers = { open: () => ctx.setCwd(entry.path) }
  // The folder itself, not the files that happen to be in it.
  if (caps.clipboard) handlers.copy = () => ctx.copyFolder(entry.path)
  if (caps.write) {
    handlers['extract-here'] = () => ctx.extractFolderHere(entry.path)
    // The FOLDER, not the files inside it (2026-09-19, found by
    // #166's e2e). Handing over each member's own path made every
    // one of them its own landing, and the landing rule drops the
    // parents above what was asked for: "Collection/sub/two.txt"
    // arrived as a bare "two.txt", so the verb that says "folder"
    // delivered a flat pile, which is the very thing Copy folder
    // was fixed for on 2026-08-31. Named as one entry, the shape
    // below it is kept, exactly as a dragged folder's is.
    handlers['extract-to'] = () => ctx.extractMembers(entry, [entry.path], false)
  }
  if (writable) handlers.delete = () => ctx.setConfirmDelMany(members)
  return fromTable(
    { kind: 'folder', writable, zip: ctx.zip },
    handlers,
    (id) => id !== 'open' && members.length === 0
  )
}

/** A FILE row's menu. */
function fileItems<E extends ArchiveMember>(ctx: ArchiveRowMenuContext<E>): MenuItem[] {
  const { entry, caps, writable } = ctx
  const handlers: Handlers = { open: () => ctx.view(entry) }
  if (caps.clipboard) handlers.copy = () => ctx.copyOut(entry)
  if (caps.write) {
    handlers['extract-here'] = () => ctx.extractMembers(entry, [entry.path], true)
    handlers['extract-to'] = () => ctx.extractMembers(entry, [entry.path], false)
  }
  if (writable) {
    handlers.rename = () => ctx.setEditing(entry.path)
    handlers.delete = () => ctx.setConfirmDel(entry)
  }
  return fromTable({ kind: 'file', writable, zip: ctx.zip }, handlers)
}

/** Empty when the host can do nothing with several at once, and the row's
 *  own menu stands in for it. The count is the FILE members: a marked
 *  folder is carried by its members. */
function multiItems<E extends ArchiveMember>(
  ctx: ArchiveRowMenuContext<E>,
  paths: string[]
): MenuItem[] {
  const files = ctx.filesOf(paths)
  const handlers: Handlers = {}
  if (ctx.caps.clipboard) handlers.copy = () => ctx.copyMany(files)
  if (ctx.caps.write) {
    handlers['extract-here'] = () => ctx.extractMembers(ctx.entry, files, true)
    handlers['extract-to'] = () => ctx.extractMembers(ctx.entry, files, false)
  }
  if (ctx.writable) handlers.delete = () => ctx.setConfirmDelMany(files)
  return fromTable(
    { kind: 'many', writable: ctx.writable, count: files.length, zip: ctx.zip },
    handlers,
    () => files.length === 0
  )
}

/**
 * A member row's menu: the several-marked menu when the row was one of
 * several marked and the host can act on several, otherwise the folder's or
 * the file's own.
 */
export function archiveRowMenu<E extends ArchiveMember>(ctx: ArchiveRowMenuContext<E>): MenuItem[] {
  if (ctx.multi) {
    const many = multiItems(ctx, ctx.multi)
    if (many.length) return many
  }
  return ctx.entry.dir ? folderItems(ctx) : fileItems(ctx)
}

export interface ArchivePanelMenuContext {
  /** The archive file itself. */
  archivePath: string
  /** Its file name, for the rows that name it. */
  zip: string
  caps: ArchiveCaps
  /** The ARCHIVE can be changed: the host writes and the container is not read-only. */
  writable: boolean
  /** A copy-out or an add is under way. */
  busy: boolean
  extractAll: (here?: boolean) => void
  addFiles: () => void
  /** The folder on show has rows to select. */
  hasRows: boolean
  selectAll: () => void
}

/**
 * The panel's DEAD SPACE (2026-08-30): the whole archive's verbs, where the
 * pointer is, as the table words them (#518), then the panel's own two:
 * Copy archive and Select all. Select all stays a ROW: the phone page has no
 * Ctrl+A, so the row is its only way to mark everything.
 */
export function archivePanelMenu(ctx: ArchivePanelMenuContext): MenuItem[] {
  const { archivePath, caps, writable, busy } = ctx
  const handlers: Handlers = {
  }
  // clipboardText, never navigator.clipboard: the phone page is plain http (#511).
  if (canCopyText()) handlers['copy-path'] = () => void clipboardText(archivePath)
  if (caps.write) {
    handlers['extract-here'] = () => ctx.extractAll(true)
    handlers['extract-to'] = () => ctx.extractAll(false)
  }
  if (writable) handlers['add-files'] = () => ctx.addFiles()
  if (caps.explorer) handlers.show = () => void window.prism.showInExplorer(archivePath)
  const table = fromTable(
    { kind: 'empty', writable, zip: ctx.zip },
    handlers,
    (id) => busy && (id === 'extract-here' || id === 'extract-to' || id === 'add-files')
  )
  return [
    ...table,
    ...(caps.clipboard ? [{ label: 'Copy archive', onPick: () => void copyFilePaths([archivePath]) }] : []),
    { label: 'Select all', hint: 'Ctrl+A', disabled: !ctx.hasRows, onPick: () => ctx.selectAll() }
  ]
}
