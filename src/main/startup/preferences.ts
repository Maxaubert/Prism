import { app } from 'electron'
import { PUSH } from '@shared/channels'
import { REMEMBER_FOLDERS_KEY } from '@shared/listingPrefs'
import { learnDriveKinds } from '../driveKinds'
import type { MainCtx } from '../ipc/context'
import { registerPreferencesIpc, registerWinEIpc } from '../ipc/window'
import { cleanDeadRuns, pidAlive } from '../memberTemp'
import { removeOldExplorerWindows } from '../oldExplorerWindows'
import { windows } from '../appState'

/**
 * The preferences group of whenReady (audit #7 step 2): the index warm-up, the
 * folder cache that follows "Remember folders", the preferences watch, the
 * clean-up of old temp folders and profiles, and the two IPC registers that
 * answer for them. Moved whole, in the same order.
 */
export function wirePreferences(ctx: MainCtx): void {
  const {
    explorerListings,
    listingCache,
    windowPreferences,
    memberTemp,
    preferencesOwner,
    warmIndexer
  } = ctx
  // Reuse a ready index before starting private background indexing. NOT
  // before the Explorer's first answer (#271): the indexer, the drive-kind
  // probe and folder sizes all want libuv's four threads, and they must not
  // queue in front of the listing the first frame is waiting for. The first
  // answer, or 1.5 s, whichever comes first.
  void explorerListings.settled.then(() => {
    void warmIndexer()
    void learnDriveKinds()
  })
  // Remember folders (#271): off deletes what was kept, at once.
  const rememberFolders = (values: Record<string, string>): void =>
    listingCache.setEnabled(values[REMEMBER_FOLDERS_KEY] !== 'off')
  rememberFolders(windowPreferences.load().values)
  // The common places are the last to be evicted (#271), with Quick access
  // (pinned as the page reads them ahead).
  for (const key of [
    'home',
    'desktop',
    'documents',
    'downloads',
    'pictures',
    'music',
    'videos'
  ] as const) {
    try {
      listingCache.pin([app.getPath(key)])
    } catch {
      /* a profile without that folder */
    }
  }
  const stopPreferencesWatch = windowPreferences.watch((snapshot) => {
    rememberFolders(snapshot.values)
    // Every window's page (2026-10-29): one store, every window shows it.
    windows.sendToAll(PUSH.windowPreferencesChanged, snapshot)
  })
  app.once('will-quit', stopPreferencesWatch)
  app.once('will-quit', () => listingCache.flush())
  // Preferences are written off main while the app runs (2026-10-12): what is
  // still waiting goes down synchronously here, or a value set just before
  // quit is lost.
  app.once('will-quit', () => windowPreferences.flush())
  // The member temp folder (#300): this run's at quit, every dead run's once
  // the first answer is in (never on the startup path, #189).
  // On the process's own exit, which `app.exit` reaches and will-quit does not.
  process.once('exit', () => memberTemp.removeRun())
  void explorerListings.settled.then(() =>
    setTimeout(() => void cleanDeadRuns(memberTemp.root, pidAlive, memberTemp.dir), 5000)
  )
  // The profiles the retired Win+E processes kept (step 2, 2026-10-29), the
  // same way: never on the startup path, and nothing to do once gone.
  void explorerListings.settled.then(() =>
    setTimeout(() => void removeOldExplorerWindows(preferencesOwner), 5000)
  )
  registerPreferencesIpc(ctx)
  registerWinEIpc(ctx)
}
