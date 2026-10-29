import { ipcMain } from 'electron'
import { CALL } from '@shared/channels'
import pkg from '../../../package.json'
import { E2E } from '../appState'
import { pickFiles, pickFolder } from '../dialogs'

/** The app's version, and opening things: the pickers. */
export function registerOpenIpc(): void {
  // package.json's, not app.getVersion(): the e2e and dev launch electron at
  // a script, and there that one answers with ELECTRON's own version (SEEN:
  // the old mock chip read "Update 43.2.0" in the e2e's own screenshots), so
  // the update window would say "You have 43.2.0".
  ipcMain.handle(CALL.appVersion, () => pkg.version)
  // E2E only (#322): a call main answers after 600 ms, so the diagLog
  // scenario can find the ipc-slow line a real slow channel would write.
  if (E2E) ipcMain.handle(CALL.e2eSlowIpc, () => new Promise((r) => setTimeout(() => r(true), 600)))

  // Choose a folder WITHOUT opening it - the Settings picker.
  // Owned by the window that asked (tab tear-off step 1, 2026-10-29).
  ipcMain.handle(CALL.dialogPickFolder, (e) => pickFolder(e.sender))
  ipcMain.handle(CALL.dialogPickFiles, (e) => pickFiles(e.sender))
}
