import { dialog } from 'electron'
import { E2E, appState } from './appState'

// main's native dialogs (stage 9c of the structure cleanup, 2026-10-12, out
// of index.ts).

/** Native dialogs are OWNED by the window (2026-08-28). Unparented, Windows
 *  makes them modeless: a click on Prism buries the picker, and in fullscreen
 *  it never shows at all, which reads as the app hanging. Before there is a
 *  window there is nothing to own them, so those keep the old shape. */
export function openDialog(
  opts: Electron.OpenDialogOptions
): Promise<Electron.OpenDialogReturnValue> {
  return appState.mainWindow
    ? dialog.showOpenDialog(appState.mainWindow, opts)
    : dialog.showOpenDialog(opts)
}

/** The same, for saving. Parented for the same reason: an unparented dialog is
 *  modeless, and a fullscreen picker never shows at all. */
export function saveDialog(
  opts: Electron.SaveDialogOptions
): Promise<Electron.SaveDialogReturnValue> {
  return appState.mainWindow
    ? dialog.showSaveDialog(appState.mainWindow, opts)
    : dialog.showSaveDialog(opts)
}

/** Choose a folder WITHOUT opening it - the Settings picker. */
export async function pickFolder(): Promise<string | null> {
  const r = await openDialog({ properties: ['openDirectory'] })
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0]
}

/** Several real files at once: the archive panel's "Add files" verb. */
export async function pickFiles(): Promise<string[]> {
  // E2E only (#300): Add files here is driven without a native dialog.
  if (E2E && process.env.PRISM_E2E_PICK_FILES)
    return process.env.PRISM_E2E_PICK_FILES.split('|').filter(Boolean)
  const r = await openDialog({ properties: ['openFile', 'multiSelections'] })
  return r.canceled ? [] : r.filePaths
}
