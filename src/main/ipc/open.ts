import { app, ipcMain } from 'electron'
import { CALL } from '@shared/channels'
import pkg from '../../../package.json'
import type { OpenPayload } from '@shared/types'
import { exists } from '../fsUtil'
import { E2E } from '../appState'
import { openDialog, pickFiles, pickFolder } from '../dialogs'
import type { MainCtx } from './context'

/** The app's version, and opening things: the open dialogs, a folder, home, a path. */
export function registerOpenIpc(ctx: MainCtx): void {
  const { buildPayload, folderPayload } = ctx
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
  // Choosing a folder rather than a file: the other way in, and the only one
  // that names the root deliberately instead of inferring it from a file.
  ipcMain.handle(CALL.openFolder, async (_e, from?: string): Promise<OpenPayload | null> => {
    // Open the browser where the tab already is: changing a tab's folder
    // almost always means a sibling or a child of the one it is on, and
    // starting at Documents made every one of those a walk.
    const at = typeof from === 'string' && (await exists(from)) ? from : undefined
    const r = await openDialog({
      properties: ['openDirectory'],
      ...(at ? { defaultPath: at } : {})
    })
    if (r.canceled || !r.filePaths.length) return null
    return folderPayload(r.filePaths[0])
  })
  // A new tab, with nothing to answer first. The + is meant to be instant, so
  // it lands somewhere sensible - the user's own folder - and the sidebar's
  // folder button is where choosing happens.
  ipcMain.handle(CALL.openHome, (): Promise<OpenPayload | null> => folderPayload(app.getPath('home')))
  // The Settings "new tabs open in" folder: stored renderer-side, opened
  // here. folderPayload refuses a path that no longer exists, and the
  // renderer falls back to home when it does.
  ipcMain.handle(CALL.openRoot, (_e, dir: string): Promise<OpenPayload | null> => folderPayload(dir))
  // Choose a folder WITHOUT opening it - the Settings picker.
  ipcMain.handle(CALL.dialogPickFolder, () => pickFolder())
  ipcMain.handle(CALL.dialogPickFiles, () => pickFiles())
  ipcMain.handle(CALL.openPath, (_e, p: string): Promise<OpenPayload | null> => buildPayload(p))
}
