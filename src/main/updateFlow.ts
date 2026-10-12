import { app, ipcMain, dialog } from 'electron'
import { hasOtherExplorerWindows } from './explorerWindow'
import { installUpdate, updateCalls, watchForUpdates, type UpdateInfo } from './update'
import { previewUpdate, runPreviewInstall, wantsPreview } from 'prism-term-core/main/updatePreview'
import pkg from '../../package.json'
import { E2E, appState } from './appState'

// THE UPDATE FLOW (stage 9c of the structure cleanup, 2026-10-12, out of
// index.ts): the offer main remembers, the check that makes one, and the
// update:* messages (announce, install, cancel). The download and the
// installer are update.ts's; the preview is prism-term-core's.

/** The newest update offer (#168), remembered so a page that loads after it
 *  was made still hears about it (`update:announce`), and so `update:install`
 *  can tell a preview from a release by what main ITSELF offered, never by what
 *  the page sent. Module state, not inside `startUpdates`, because a SECOND
 *  launch can ask for the preview too (`Prism.exe --preview-update` while Prism is
 *  resident, which is the likely way the flag gets used). */
let pendingUpdate: UpdateInfo | null = null
/** The install that is running, if one is: what `update:cancel` aborts. */
let updateRun: AbortController | null = null
export function offerUpdate(info: UpdateInfo): void {
  pendingUpdate = info
  appState.mainWindow?.webContents.send('update:available', info)
}

/** A real or preview offer is on the table (a second launch's
 *  `--preview-update` never replaces one). */
export const updateOffered = (): boolean => !!pendingUpdate

/**
 * Start the check and register the update:* messages. `preferencesOwner` is
 * the profile whose other Explorer windows must close before an install.
 */
export function startUpdates(preferencesOwner: string): void {
  // The update check: watch GitHub Releases, remember the newest offer so a
  // renderer that loads after the tick still hears about it (`offerUpdate`
  // and `pendingUpdate`, above).
  //
  // A PREVIEW (#168; owner, 2026-09-19: "I would want to see how the Update
  // banner looks in both apps, so if you could enable it and make like a fake
  // update"): `--preview-update`, in the INSTALLED app as well, announces the
  // core's fake offer at once and the real watcher is never started, so the
  // network is never touched. An unpackaged build previews without being
  // asked, which is what the inert mock chip used to be for. Under --e2e
  // NEITHER happens unless the flag is there: the suite must never ask
  // GitHub, and its title bar is measured with no chip in it (until this
  // change the mock was there in every scenario, asserted by none).
  if (wantsPreview(process.argv) || (!app.isPackaged && !E2E))
    offerUpdate(previewUpdate(pkg.version))
  else if (!E2E) watchForUpdates(offerUpdate)
  // The e2e's updateGuard: a REAL-shaped offer (not a mock, so Install goes
  // through the unsaved-text and working-agent questions) whose url
  // `installUpdate` refuses before it sends anything, because it is not one
  // of this repo's release assets. That is what lets the guard and the
  // failure line be driven with no network and no installer. The notes are
  // the scenario's to choose: it hands over a hostile body, to prove in the
  // real page that none of it is rendered.
  else if (process.env.PRISM_E2E_UPDATE_OFFER)
    offerUpdate({
      version: '99.0.0',
      url: process.env.PRISM_E2E_UPDATE_OFFER,
      notes: process.env.PRISM_E2E_UPDATE_NOTES ?? ''
    })
  ipcMain.on('update:announce', (e) => {
    if (pendingUpdate) e.sender.send('update:available', pendingUpdate)
  })
  // Installing quits the app so NSIS can replace it. A dirty buffer VETOES
  // that quit (the close flow below), so without asking first the installer
  // would run over a live exe while a save dialog waited (2026-08-28). The
  // renderer answers Cancel / Discard / Save all before the download starts.
  ipcMain.handle('update:install', async (_e, url: string) => {
    // WHAT IS ON OFFER decides, never what the page sent (#168): while the
    // offer is a preview there is nothing this handler will download,
    // whatever url it is handed. The fake runs the chip's progress and
    // answers false, "nothing was installed", which is true. No fetch, no
    // file, no installer, no quit, and the close question is NOT
    // pre-answered: `closeConfirmed` and `installingUpdate` stay as they are.
    if (pendingUpdate?.mock) {
      // Cancellable like the real one (#178): a preview is where most people
      // will ever press the window's Cancel.
      if (updateRun) return false
      const fake = new AbortController()
      updateRun = fake
      try {
        return await runPreviewInstall(
          (pct) => appState.mainWindow?.webContents.send('update:progress', pct),
          { cancelled: () => fake.signal.aborted }
        )
      } finally {
        updateRun = null
      }
    }
    if (typeof url !== 'string') return false
    // Unsaved text VETOES the quit this ends in (win.on('close') below), so
    // installing over it would run NSIS against a live exe while a dialog
    // waited (2026-08-28). The renderer settles the question first and this
    // refuses until it has; then the quit is pre-answered, like any other
    // route the user has already agreed to.
    if (appState.editorDirty) return false
    const canInstall = async (): Promise<boolean> => {
      if (!(await hasOtherExplorerWindows(preferencesOwner))) return !appState.editorDirty
      if (appState.mainWindow)
        await dialog.showMessageBox(appState.mainWindow, {
          type: 'info',
          message: 'Close the other Prism windows before installing the update.',
          detail: 'This keeps their open files and terminals safe.',
          buttons: ['OK']
        })
      return false
    }
    if (appState.installingUpdate || !(await canInstall())) return false
    appState.installingUpdate = true
    appState.closeConfirmed = true
    const run = new AbortController()
    updateRun = run
    const ok = await installUpdate(
      url,
      (pct) => appState.mainWindow?.webContents.send('update:progress', pct),
      canInstall,
      run.signal
    ).finally(() => {
      updateRun = null
    })
    // A download that FAILED must not leave the close question pre-answered
    // for the rest of the session: the next Alt+F4 over unsaved text would
    // close over the top of it without asking.
    if (!ok) {
      appState.closeConfirmed = false
      appState.installingUpdate = false
    }
    return ok
  })
  // The update window's Cancel (#178). It names nothing: there is one
  // download at most, and the page has no say in which.
  ipcMain.on('update:cancel', () => updateRun?.abort())
  // The e2e's updateWindow reads this (through `app.evaluate`, as it reaches
  // the indexer) after a whole preview, fake install included: release
  // checks sent and installs attempted. Both must still be 0.
  if (E2E)
    (
      globalThis as typeof globalThis & { __prismUpdateCalls?: typeof updateCalls }
    ).__prismUpdateCalls = updateCalls
}
