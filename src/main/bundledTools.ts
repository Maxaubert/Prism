import { app } from 'electron'
import { findFfmpeg, type FfmpegTools } from './ffmpeg'
import { findFluid, type Fluid } from './midi'
import { bundledSeven } from './sevenZip'

/**
 * The programs Prism ships, found once each (stage 9b of the structure
 * cleanup, 2026-10-12). Every caller used to spell out
 * `findFfmpeg(app.isPackaged, process.resourcesPath, app.getAppPath())`; the
 * finders cache their own answers, so these are as cheap as before.
 */
export const ffmpegTools = (): FfmpegTools | null =>
  findFfmpeg(app.isPackaged, process.resourcesPath, app.getAppPath())

export const sevenExe = (): string | null =>
  bundledSeven(app.isPackaged, process.resourcesPath, app.getAppPath())

export const fluidTools = (): Promise<Fluid | null> =>
  findFluid(app.isPackaged, process.resourcesPath, app.getAppPath())
