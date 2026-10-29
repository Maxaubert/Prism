import { app, ipcMain } from 'electron'
import { CALL } from '@shared/channels'
import { join } from 'path'
import { createWinEShortcut } from '../winEShortcut'
import { createFolderHandler } from '../folderHandler'
import { REMEMBER_FOLDERS_KEY } from '@shared/listingPrefs'
import { type SavedTabs } from '../tabs'
import { E2E, windows } from '../appState'
import type { MainCtx } from './context'

/** The window's preferences (shared between Prism's windows): load, seed, set.
 *  Any Prism page may (2026-10-29: every window of the process is one), and a
 *  preview's frame never. */
export function registerPreferencesIpc(ctx: MainCtx): void {
  const { extraWindowOwner, listingCache, preferencesLoaded, windowPreferences } = ctx
  ipcMain.on(CALL.windowPreferencesLoad, (event) => {
    const page = windows.isPrismPage(event.sender)
    event.returnValue = page ? windowPreferences.load() : null
    if (page && extraWindowOwner) preferencesLoaded()
  })
  // A later window finds the store already shared and never seeds it again
  // (lib/windowPreferences.ts seeds only when `!snapshot.shared`); a second
  // seed would be harmless anyway, the promise resolves once.
  ipcMain.on(CALL.windowPreferencesSeed, (event, values: unknown) => {
    event.returnValue = null
    if (!windows.isPrismPage(event.sender)) return
    try {
      event.returnValue = windowPreferences.seed(values)
    } catch {
      /* Local preferences still work if the shared store is unavailable. */
    } finally {
      preferencesLoaded()
    }
  })
  ipcMain.on(CALL.windowPreferencesSet, (event, change: unknown) => {
    event.returnValue = windows.isPrismPage(event.sender) && windowPreferences.set(change)
    // The switch takes effect now, not when the folder watch gets round to it.
    const c = change as { key?: unknown; value?: unknown } | null
    if (event.returnValue && c?.key === REMEMBER_FOLDERS_KEY)
      listingCache.setEnabled(c.value !== 'off')
  })
}

/** Win+E: the shortcut's switch, and the requests it hands this window. */
export function registerWinEIpc(ctx: MainCtx): void {
  const { extraWindowOwner, preferencesOwner, winERequests } = ctx
  const winE = createWinEShortcut({
    helper: join(process.resourcesPath, 'win-e', 'PrismShortcut.exe'),
    executable: process.execPath,
    profile: preferencesOwner,
    supported: process.platform === 'win32' && app.isPackaged && !E2E
  })
  ipcMain.handle(CALL.winEStatus, (event) => {
    if (!windows.isPrismPage(event.sender)) throw new Error('Unknown window')
    return winE.status()
  })
  ipcMain.handle(CALL.winESet, (event, enabled: unknown) => {
    if (!windows.isPrismPage(event.sender) || typeof enabled !== 'boolean')
      throw new Error('Invalid shortcut request')
    return winE.set(enabled)
  })
  // A cold start's Win+E lands in the session's FIRST window (2026-10-29),
  // as it always did: only its page listens for the queue and answers it.
  const winEHost = (sender: Electron.WebContents): boolean => !!windows.of(sender)?.first && windows.isPrismPage(sender)
  ipcMain.on(CALL.winEListen, (event) => {
    if (winEHost(event.sender)) winERequests.listen()
  })
  ipcMain.on(CALL.winEReady, (event, id: unknown) => {
    if (winEHost(event.sender) && typeof id === 'string') winERequests.ready(id)
  })
  if (!extraWindowOwner) void winE.resume()
  // Open folders in Prism (#393): the same helper, a copy of it outside the
  // install folder answering Windows' folder verb.
  const folders = createFolderHandler({
    helper: join(process.resourcesPath, 'win-e', 'PrismShortcut.exe'),
    executable: process.execPath,
    profile: preferencesOwner,
    supported: process.platform === 'win32' && app.isPackaged && !E2E,
    marker: join(preferencesOwner, 'folders-on')
  })
  ipcMain.handle(CALL.foldersStatus, (event) => {
    if (!windows.isPrismPage(event.sender)) throw new Error('Unknown window')
    return folders.status()
  })
  ipcMain.handle(CALL.foldersSet, (event, on: unknown) => {
    if (!windows.isPrismPage(event.sender) || typeof on !== 'boolean') throw new Error('Invalid folder request')
    return folders.set(on)
  })
  if (!extraWindowOwner) void folders.repair()
}

/** What the renderer reports for the session: the tab strip, playing media, a dropped root. */
export function registerSessionIpc(ctx: MainCtx): void {
  const { keepAwake, reportTabs } = ctx
  // Each window's own strip, into its own entry (2026-10-29): two windows
  // never overwrite each other's.
  ipcMain.on(CALL.tabsChanged, (e, state: SavedTabs) => reportTabs(e.sender, state))
  // The renderer is the only thing that knows whether a media element is
  // actually playing, so it owns the answer and main just holds the block,
  // while ANY window plays (keepAwake counts them by page).
  ipcMain.on(CALL.powerAwake, (e, on: boolean) => keepAwake(e.sender, on))
}
