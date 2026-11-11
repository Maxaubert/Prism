import { ipcMain } from 'electron'
import { CALL } from '@shared/channels'
import { ICON_CONVERT_PX, type IconList, type IconPick, type IconSave } from '@shared/folderIconFiles'
import { E2E } from '../appState'
import { ffmpegTools } from '../bundledTools'
import { pickIconFile, rememberIconDir } from '../dialogs'
import {
  FRESH_MS,
  listIconFiles,
  readIconSource,
  removeUnusedIcons,
  saveIconPng,
  type IconDecoders
} from '../folderIconFiles'
import { heicToJpeg } from '../heicClient'
import { decodeIconPng } from '../imageDecode'
import { userPaths } from '../paths'
import { readRawPreview } from '../rawPreview'

/** The viewer's own decoders, for the kinds the page cannot decode
 *  (2026-11-11). No ffmpeg in this install: those kinds are refused. */
const decoders = (): IconDecoders => {
  const ffmpeg = ffmpegTools()?.ffmpeg ?? null
  return {
    toPng: ffmpeg ? (file) => decodeIconPng(ffmpeg, file, ICON_CONVERT_PX) : null,
    heic: heicToJpeg,
    raw: readRawPreview
  }
}

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
    const read = await readIconSource(path, decoders())
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
