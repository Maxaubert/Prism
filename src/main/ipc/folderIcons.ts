import { ipcMain } from 'electron'
import { CALL } from '@shared/channels'
import type { IconList, IconPick, IconSave } from '@shared/folderIconFiles'
import { E2E } from '../appState'
import { pickIconFile, rememberIconDir } from '../dialogs'
import { FRESH_MS, listIconFiles, readIconSource, removeUnusedIcons, saveIconPng } from '../folderIconFiles'
import { userPaths } from '../paths'

/** The prune's grace period; the e2e shortens it (`PRISM_E2E_ICON_FRESH_MS`)
 *  to see a reset's copy go without waiting a minute. */
const fresh = (): number => {
  const ms = E2E ? Number(process.env.PRISM_E2E_ICON_FRESH_MS) : NaN
  return Number.isFinite(ms) && ms >= 0 ? ms : FRESH_MS
}

/**
 * Folder icons from a file (2026-10-31). The page asks main to pick a picture
 * and gets its BYTES (never a path it could load), sends back the 64 px PNG it
 * drew, and reads the kept copies as data URLs. All `fs/promises`.
 */
export function registerFolderIconIpc(): void {
  ipcMain.handle(CALL.folderIconPick, async (e): Promise<IconPick> => {
    const path = await pickIconFile(e.sender)
    if (!path) return null
    const read = await readIconSource(path)
    if ('bytes' in read) await rememberIconDir(path)
    return read
  })
  ipcMain.handle(CALL.folderIconSave, (_e, bytes: unknown): Promise<IconSave> | IconSave =>
    bytes instanceof Uint8Array ? saveIconPng(userPaths.folderIcons(), bytes) : { refused: 'not-picture' }
  )
  ipcMain.handle(CALL.folderIconFiles, (): Promise<IconList> => listIconFiles(userPaths.folderIcons()))
  ipcMain.handle(CALL.folderIconPrune, (_e, keep: unknown) =>
    Array.isArray(keep)
      ? removeUnusedIcons(
          userPaths.folderIcons(),
          keep.filter((k): k is string => typeof k === 'string'),
          Date.now(),
          fresh()
        )
      : 0
  )
}
