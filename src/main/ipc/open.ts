import { ipcMain } from 'electron'
import { CALL } from '@shared/channels'
import pkg from '../../../package.json'
import type { OpenPayload } from '@shared/types'
import { E2E } from '../appState'
import { openDialog, pickFiles, pickFolder } from '../dialogs'
import type { MainCtx } from './context'

/** The app's version, and opening things: the open dialog and the pickers. */
export function registerOpenIpc(ctx: MainCtx): void {
  const { buildPayload } = ctx
  // package.json's, not app.getVersion(): the e2e and dev launch electron at
  // a script, and there that one answers with ELECTRON's own version (SEEN:
  // the old mock chip read "Update 43.2.0" in the e2e's own screenshots), so
  // the update window would say "You have 43.2.0".
  ipcMain.handle(CALL.appVersion, () => pkg.version)
  // E2E only (#322): a call main answers after 600 ms, so the diagLog
  // scenario can find the ipc-slow line a real slow channel would write.
  if (E2E) ipcMain.handle(CALL.e2eSlowIpc, () => new Promise((r) => setTimeout(() => r(true), 600)))

  ipcMain.handle(CALL.openDialog, async (): Promise<OpenPayload | null> => {
    const r = await openDialog({ properties: ['openFile'] })
    if (r.canceled || !r.filePaths.length) return null
    return buildPayload(r.filePaths[0])
  })
  // Choose a folder WITHOUT opening it - the Settings picker.
  ipcMain.handle(CALL.dialogPickFolder, () => pickFolder())
  ipcMain.handle(CALL.dialogPickFiles, () => pickFiles())
}
