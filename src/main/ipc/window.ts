import { app, ipcMain } from 'electron'
import { CALL } from '@shared/channels'
import { join } from 'path'
import { createWinEShortcut } from '../winEShortcut'
import { createFolderHandler } from '../folderHandler'
import { dropRoot } from '../roots'
import { REMEMBER_FOLDERS_KEY } from '@shared/listingPrefs'
import { type SavedTabs } from '../tabs'
import { killWarm } from 'prism-term-core/main/terminal'
import { E2E, isMainSender } from '../appState'
import type { MainCtx } from './context'

/** The window's preferences (shared between Prism's windows): load, seed, set. */
export function registerPreferencesIpc(ctx: MainCtx): void {
  const { extraWindowOwner, listingCache, preferencesLoaded, windowPreferences } = ctx
  ipcMain.on(CALL.windowPreferencesLoad, (event) => {
    event.returnValue =
      isMainSender(event.sender) ? windowPreferences.load() : null
    if (isMainSender(event.sender) && extraWindowOwner) preferencesLoaded()
  })
  ipcMain.on(CALL.windowPreferencesSeed, (event, values: unknown) => {
    event.returnValue = null
    if (!isMainSender(event.sender)) return
    try {
      event.returnValue = windowPreferences.seed(values)
    } catch {
      /* Local preferences still work if the shared store is unavailable. */
    } finally {
      preferencesLoaded()
    }
  })
  ipcMain.on(CALL.windowPreferencesSet, (event, change: unknown) => {
    event.returnValue =
      isMainSender(event.sender) && windowPreferences.set(change)
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
    if (!isMainSender(event.sender)) throw new Error('Unknown window')
    return winE.status()
  })
  ipcMain.handle(CALL.winESet, (event, enabled: unknown) => {
    if (!isMainSender(event.sender) || typeof enabled !== 'boolean')
      throw new Error('Invalid shortcut request')
    return winE.set(enabled)
  })
  ipcMain.on(CALL.winEListen, (event) => {
    if (isMainSender(event.sender)) winERequests.listen()
  })
  ipcMain.on(CALL.winEReady, (event, id: unknown) => {
    if (isMainSender(event.sender) && typeof id === 'string')
      winERequests.ready(id)
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
    if (!isMainSender(event.sender)) throw new Error('Unknown window')
    return folders.status()
  })
  ipcMain.handle(CALL.foldersSet, (event, on: unknown) => {
    if (!isMainSender(event.sender) || typeof on !== 'boolean') throw new Error('Invalid folder request')
    return folders.set(on)
  })
  if (!extraWindowOwner) void folders.repair()
}

/** What the renderer reports for the session: the tab strip, playing media, a dropped root. */
export function registerSessionIpc(ctx: MainCtx): void {
  const { keepAwake, saveTabs } = ctx
  ipcMain.on(CALL.tabsChanged, (_e, state: SavedTabs) => saveTabs(state))
  // The renderer is the only thing that knows whether a media element is
  // actually playing, so it owns the answer and main just holds the block.
  ipcMain.on(CALL.powerAwake, (_e, on: boolean) => keepAwake(on))
  // A root no longer held by ANY tab (closed, or rerooted away). Explicit,
  // one at a time, from the owner of the tab list.
  ipcMain.on(CALL.rootsDrop, (_e, root: string) => {
    dropRoot(root)
    killWarm(root) // a warm spare for a closed tab is an orphan
  })
}
