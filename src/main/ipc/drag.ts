import { app, ipcMain, nativeImage, type WebContents } from 'electron'
import { stat } from 'fs/promises'
import { CALL, PUSH } from '@shared/channels'
import { insideDesktop } from '../desktopAccess'
import { createDragOut, type DragOut } from '../dragOut'
import { recordFakeDrag } from '../e2eDragOut'
import { E2E, windows } from '../appState'
import type { ArchiveBodies } from './archive'
import type { MainCtx } from './context'

const trimEntry = (e: string): string => e.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')

/**
 * DRAG OUT OF PRISM (#103): `drag:prepare` on the press, `drag:out` at the
 * window's edge. The logic and its guards are `dragOut.ts`; this wires them
 * to Electron (startDrag, the file icon, every window) and to the archive
 * bodies a member's temp copy comes from. Nothing new is granted: every path
 * passes the root wall (`readable`), members are main's own temp copies.
 */
export function registerDragIpc(ctx: MainCtx, bodies: ArchiveBodies): DragOut {
  const { readable, archives, memberTemp } = ctx
  // The app's own icon, the fallback when a file has none: read once, async,
  // from the executable (createFromPath would read the disk on main).
  let appIcon: Electron.NativeImage | null = null
  void app
    .getFileIcon(process.execPath, { size: 'normal' })
    .then((i) => {
      if (!i.isEmpty()) appIcon = i
    })
    .catch(() => {})
  /** Never empty: Electron throws on an empty drag icon. One opaque pixel
   *  stands in until the app's icon has been read. */
  const PIXEL = nativeImage.createFromBuffer(
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
  )
  const dragOut = createDragOut<WebContents, Electron.NativeImage>({
    e2e: E2E,
    readable,
    kindOf: (p) =>
      stat(p).then(
        (s) => (s.isDirectory() ? 'dir' : 'file'),
        () => undefined
      ),
    fileIcon: (p) => app.getFileIcon(p, { size: 'normal' }),
    appIcon: () => appIcon ?? PIXEL,
    startDrag: (sender, item) => sender.startDrag(item),
    senderId: (sender) => sender.id,
    broadcast: (channel, payload) =>
      void windows.sendToAll(channel === 'start' ? PUSH.dragNativeStart : PUSH.dragNativeEnd, payload),
    pin: (paths, until) => memberTemp.pin(paths, until),
    record: recordFakeDrag,
    members: {
      async resolve(place) {
        const r = await archives.resolve(place, { enterLast: false })
        if (!r?.ok || !r.place.entry || !insideDesktop(r.place.outer)) return null
        const e = r.place.entry
        const entry = trimEntry(e.path)
        const size = e.dir
          ? r.place.parsed.entries
              .filter((x) => !x.dir && trimEntry(x.path).startsWith(entry + '/'))
              .reduce((n, x) => n + x.size, 0)
          : e.size
        return { real: r.place.real, entry, dir: e.dir, size }
      },
      signature: (real) =>
        stat(real).then(
          (s) => `${s.size}:${Math.round(s.mtimeMs)}`,
          () => null
        ),
      async extractFile(place) {
        const out = await archives.member(place, undefined, true)
        if (!out.ok) return null
        memberTemp.touch(out.path)
        return out.path
      },
      // Into the run's member folder (#103): no temp folder outlives the run.
      extractDir: (real, entry, size) => bodies.extractDirTemp(real, entry, size)
    }
  })
  ipcMain.handle(CALL.dragPrepare, (_e, req: unknown) => dragOut.prepare(req))
  ipcMain.handle(CALL.dragOut, (e, req: unknown) => dragOut.out(e.sender, req))
  // The button came up after the page asked for a hand-off (see `cancel`).
  ipcMain.on(CALL.dragOutCancel, (e) => dragOut.cancel(e.sender))
  return dragOut
}
