import { ipcMain } from 'electron'
import { CALL } from '@shared/channels'
import type { IconPick, IconSave } from '@shared/folderIconFiles'
import { pickIconFile } from '../dialogs'
import { listIconFiles, readIconSource, removeUnusedIcons, saveIconPng } from '../folderIconFiles'
import { userPaths } from '../paths'

/**
 * Folder icons from a file (2026-10-31). The page asks main to pick a picture
 * and gets its BYTES (never a path it could load), sends back the 64 px PNG it
 * drew, and reads the kept copies as data URLs. All `fs/promises`.
 */
export function registerFolderIconIpc(): void {
  ipcMain.handle(CALL.folderIconPick, async (e): Promise<IconPick> => {
    const path = await pickIconFile(e.sender)
    return path ? readIconSource(path) : null
  })
  ipcMain.handle(CALL.folderIconSave, (_e, bytes: unknown): Promise<IconSave> | IconSave =>
    bytes instanceof Uint8Array ? saveIconPng(userPaths.folderIcons(), bytes) : { refused: 'not-picture' }
  )
  ipcMain.handle(CALL.folderIconFiles, () => listIconFiles(userPaths.folderIcons()))
  ipcMain.handle(CALL.folderIconPrune, (_e, keep: unknown) =>
    Array.isArray(keep)
      ? removeUnusedIcons(
          userPaths.folderIcons(),
          keep.filter((k): k is string => typeof k === 'string')
        )
      : 0
  )
}
