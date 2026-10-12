import { ipcMain } from 'electron'
import { basename, join } from 'path'
import { open as openFile, readdir, stat, statfs } from 'fs/promises'
import { spawn } from 'child_process'
import { insideDesktop } from '../desktopAccess'
import { getIndexedFolderSizes } from '../everythingBrowse'
import { photoInfo, type PhotoInfo } from '../photoInfo'
import { mediaPicture, mediaProps } from '../propsMedia'
import { detectText, TEXT_PROBE_BYTES } from '../textProps'
import { driveModel } from '../driveModel'
import { hashFile } from '../fileHash'
import type { DriveDetails, MediaProps, TextProps } from '@shared/props'
import { ffmpegTools } from '../bundledTools'
import type { MainCtx } from './context'

/** The Properties window: a photo's EXIF, media and text details, drives, hashes. */
export function registerPropsIpc(ctx: MainCtx): void {
  const { readable } = ctx
  /**
   * What the camera wrote into the photo, for the Properties rows.
   *
   * Read in MAIN from the path, because the renderer's copy of a HEIC, a
   * camera RAW or an ffmpeg-decoded still is a re-encoded picture with the
   * metadata stripped - exactly the photos worth asking about. Answers an
   * empty object rather than throwing: a picture with no EXIF is not an
   * error.
   */
  ipcMain.handle('image:photo-info', async (_e, p: string): Promise<PhotoInfo> => {
    if (!readable(p)) return {}
    return photoInfo(p)
  })

  // What the Properties popup can't compute in the renderer: dates and the
  // authoritative size, straight from the file system. Root-guarded.
  // Created and Opened are the Properties window's (owner, 2026-10-12).
  ipcMain.handle(
    'file:stat',
    async (
      _e,
      p: string
    ): Promise<{
      size: number
      mtimeMs: number
      birthtimeMs: number
      atimeMs: number
      isFolder: boolean
    } | null> => {
      if (!insideDesktop(p)) return null
      try {
        const st = await stat(p)
        return {
          size: st.size,
          mtimeMs: st.mtimeMs,
          birthtimeMs: st.birthtimeMs,
          atimeMs: st.atimeMs,
          isFolder: st.isDirectory()
        }
      } catch {
        return null
      }
    }
  )

  /* ----- the Properties window (owner, 2026-10-12) ----- */

  // What the window shows beyond `file:stat`, per kind (spec
  // `docs/superpowers/specs/2026-10-12-properties-window-design.md`). Every
  // read keeps the wall: inside a root, or a member main extracted itself.
  // The guard is the wall's `readable` (pathWall.ts).
  const mediaTools = (): { ffmpeg: string; ffprobe: string } | null => {
    const tools = ffmpegTools()
    return tools?.ffprobe ? { ffmpeg: tools.ffmpeg, ffprobe: tools.ffprobe } : null
  }
  ipcMain.handle('props:media', async (_e, p: unknown): Promise<MediaProps | null> => {
    const tools = readable(p) ? mediaTools() : null
    return tools ? mediaProps(tools.ffprobe, p as string) : null
  })
  // One JPEG as a data: URL, so the picture crosses no protocol wall.
  ipcMain.handle('props:picture', async (_e, p: unknown): Promise<string | null> => {
    const tools = readable(p) ? mediaTools() : null
    return tools ? mediaPicture(tools.ffmpeg, tools.ffprobe, p as string) : null
  })
  ipcMain.handle('props:text', async (_e, p: unknown): Promise<TextProps | null> => {
    if (!readable(p)) return null
    let handle: Awaited<ReturnType<typeof openFile>> | undefined
    try {
      handle = await openFile(p, 'r')
      const size = (await handle.stat()).size
      const buffer = Buffer.alloc(Math.min(size, TEXT_PROBE_BYTES))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      return detectText(buffer.subarray(0, bytesRead), size <= bytesRead)
    } catch {
      return null
    } finally {
      await handle?.close().catch(() => {})
    }
  })
  // A drive root is the Explorer's to browse whatever the roots are (the
  // places panel lists every drive, and `browse:drives` and
  // `browse:directory` ask no grant), so only its shape is checked here.
  const DRIVE_ROOT = /^[A-Z]:\\$/i
  ipcMain.handle('drive:details', async (_e, root: unknown): Promise<DriveDetails | null> => {
    if (typeof root !== 'string' || !DRIVE_ROOT.test(root)) return null
    const drive = root.toUpperCase()
    const space = statfs(drive).then(
      (s) => ({ total: s.blocks * s.bsize, free: s.bavail * s.bsize }),
      () => null
    )
    const folders = readdir(drive, { withFileTypes: true }).then(
      async (entries) => {
        // A junction ("Documents and Settings") is not a directory here, so
        // nothing is counted twice; hidden and system folders are kept.
        const paths = entries.filter((e) => e.isDirectory()).map((e) => join(drive, e.name))
        const sizes = paths.length ? await getIndexedFolderSizes(paths).catch(() => null) : null
        if (!sizes?.size) return null
        return paths
          .filter((path) => sizes.has(path))
          .map((path) => ({ path, name: basename(path), bytes: sizes.get(path)!.bytes }))
          .sort((a, b) => b.bytes - a.bytes)
      },
      () => null
    )
    const [model, usage, sized] = await Promise.all([
      driveModel(drive).catch(() => ({})),
      space,
      folders
    ])
    return {
      ...model,
      ...(usage && usage.total > 0
        ? { total: usage.total, free: Math.min(Math.max(usage.free, 0), usage.total) }
        : {}),
      folders: sized
    }
  })
  // Windows' own Disk Cleanup for that drive: Prism has no cleaner of its own.
  ipcMain.handle('drive:cleanup', (_e, root: unknown): boolean => {
    if (typeof root !== 'string' || !DRIVE_ROOT.test(root)) return false
    try {
      const exe = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cleanmgr.exe')
      // A missing cleanmgr (some Server and LTSC builds) fails as an 'error'
      // event after spawn returns; unheard, it would throw in main.
      const child = spawn(exe, ['/d', root[0].toUpperCase()], { detached: true, stdio: 'ignore' })
      child.on('error', () => {})
      child.unref()
      return true
    } catch {
      return false
    }
  })
  // SHA-256, streamed, with progress at most every HASH_TICK ms and a Stop.
  // Keyed by the asking page and its id, so one page cannot stop another's.
  const HASH_TICK = 100
  const hashes = new Map<string, AbortController>()
  ipcMain.handle('file:hash', async (event, p: unknown, id: unknown): Promise<string | null> => {
    if (!readable(p) || typeof id !== 'string' || !id || id.length > 200) return null
    const key = `${event.sender.id}:${id}`
    hashes.get(key)?.abort()
    const stop = new AbortController()
    hashes.set(key, stop)
    // A page that goes away (the window reloads or closes) stops its read.
    const gone = (): void => stop.abort()
    event.sender.once('destroyed', gone)
    let last = 0
    try {
      return await hashFile(
        p,
        (done, total) => {
          const now = Date.now()
          if (now - last < HASH_TICK && done < total) return
          last = now
          if (!event.sender.isDestroyed())
            event.sender.send('file:hash-progress', { id, done, total })
        },
        stop.signal
      )
    } finally {
      if (!event.sender.isDestroyed()) event.sender.removeListener('destroyed', gone)
      if (hashes.get(key) === stop) hashes.delete(key)
    }
  })
  ipcMain.on('file:hash-cancel', (event, id: unknown) => {
    if (typeof id === 'string') hashes.get(`${event.sender.id}:${id}`)?.abort()
  })
}
