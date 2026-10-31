import { app, dialog, type BrowserWindow } from 'electron'
import { dirname } from 'path'
import { ICON_FILE_EXTS } from '@shared/folderIconFiles'
import { E2E, windows } from './appState'
import { readLastIconDir, writeLastIconDir } from './folderIconFiles'
import { userPaths } from './paths'

// main's native dialogs (stage 9c of the structure cleanup, 2026-10-12, out
// of index.ts).

/** The page that asked for a dialog (an IPC `event.sender`). */
export type DialogOwner = { id: number } | null | undefined
/** The window a dialog belongs to: the one whose page asked (tab tear-off
 *  step 1, 2026-10-29), else the one focused last. */
const ownerOf = (sender: DialogOwner): BrowserWindow | null =>
  windows.windowOf(sender) ?? windows.target()?.win ?? null

/** Native dialogs are OWNED by the window (2026-08-28). Unparented, Windows
 *  makes them modeless: a click on Prism buries the picker, and in fullscreen
 *  it never shows at all, which reads as the app hanging. Before there is a
 *  window there is nothing to own them, so those keep the old shape. With
 *  several windows the owner is the window that asked (`sender`). */
export function openDialog(
  opts: Electron.OpenDialogOptions,
  sender?: DialogOwner
): Promise<Electron.OpenDialogReturnValue> {
  const owner = ownerOf(sender)
  return owner ? dialog.showOpenDialog(owner, opts) : dialog.showOpenDialog(opts)
}

/** The same, for saving. Parented for the same reason: an unparented dialog is
 *  modeless, and a fullscreen picker never shows at all. */
export function saveDialog(
  opts: Electron.SaveDialogOptions,
  sender?: DialogOwner
): Promise<Electron.SaveDialogReturnValue> {
  const owner = ownerOf(sender)
  return owner ? dialog.showSaveDialog(owner, opts) : dialog.showSaveDialog(opts)
}

/** Choose a folder WITHOUT opening it - the Settings picker. */
export async function pickFolder(sender?: DialogOwner): Promise<string | null> {
  const r = await openDialog({ properties: ['openDirectory'] }, sender)
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0]
}

/** Several real files at once: the archive panel's "Add files" verb. */
export async function pickFiles(sender?: DialogOwner): Promise<string[]> {
  // E2E only (#300): Add files here is driven without a native dialog.
  if (E2E && process.env.PRISM_E2E_PICK_FILES)
    return process.env.PRISM_E2E_PICK_FILES.split('|').filter(Boolean)
  const r = await openDialog({ properties: ['openFile', 'multiSelections'] }, sender)
  return r.canceled ? [] : r.filePaths
}

/** What the icon picker would have opened with, for the e2e (it never shows
 *  a real dialog). */
type E2eIconDialog = { defaultPath?: string; filters?: Electron.FileFilter[] }

/**
 * A picture for a folder icon (folder icons from a file, 2026-10-31): the
 * open dialog, parented to the window that asked, on the folder of the last
 * pick (Pictures the first time, or when that folder is gone; D11). Only a
 * pick that becomes a picture remembers its folder (`rememberIconDir`, review
 * L2). Under `--e2e` it never shows a dialog: it answers
 * `PRISM_E2E_PICK_ICON` (unset or empty is a cancel) and records the options
 * it would have used in `globalThis.__e2eIconDialog`.
 */
export async function pickIconFile(sender?: DialogOwner): Promise<string | null> {
  const opts: Electron.OpenDialogOptions = {
    title: 'Choose a picture for the icon',
    defaultPath: await readLastIconDir(userPaths.iconPicks(), app.getPath('pictures')),
    filters: [{ name: 'Pictures and icons', extensions: [...ICON_FILE_EXTS] }],
    properties: ['openFile']
  }
  let picked: string | null
  // Under --e2e there is never a real dialog: no PRISM_E2E_PICK_ICON is a cancel.
  if (E2E) {
    ;(globalThis as { __e2eIconDialog?: E2eIconDialog }).__e2eIconDialog = {
      defaultPath: opts.defaultPath,
      filters: opts.filters
    }
    picked = process.env.PRISM_E2E_PICK_ICON || null
  } else {
    const r = await openDialog(opts, sender)
    picked = r.canceled || !r.filePaths.length ? null : r.filePaths[0]
  }
  return picked
}

/** The pick was read as a picture: its folder is where the next one starts
 *  (spec 2.4, "after every successful pick"). */
export async function rememberIconDir(picked: string): Promise<void> {
  await writeLastIconDir(userPaths.iconPicks(), dirname(picked)).catch(() => {})
}
