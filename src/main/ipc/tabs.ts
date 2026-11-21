import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { CALL } from '@shared/channels'
import { validCarry, validStripReport, validTearRequest, type Point } from '@shared/tabTear'
import { E2E, windows } from '../appState'
import type { createTearOff } from '../tearOff'
import type { createPreviewWindows } from '../previewWindow'

type Tear = ReturnType<typeof createTearOff<BrowserWindow>>
type PreviewWindows = ReturnType<typeof createPreviewWindows<BrowserWindow>>

const isPoint = (p: unknown): p is Point =>
  !!p && Number.isFinite((p as Point).x) && Number.isFinite((p as Point).y)

/** The preview window's IPC: from a Prism page (never the spare), about its
 *  own window only. */
export function registerPreviewWindowIpc(previewWindows: PreviewWindows): void {
  const owner = (sender: Electron.WebContents): BrowserWindow | null => {
    const r = windows.of(sender)
    return r && !r.spare && !r.win.isDestroyed() ? r.win : null
  }
  ipcMain.handle(CALL.previewWindowArm, (e) => {
    const w = owner(e.sender)
    return w ? previewWindows.arm(w) : null
  })
  ipcMain.on(CALL.previewWindowShow, (e, animate: unknown) => {
    const w = owner(e.sender)
    if (w) previewWindows.show(w, animate !== false)
  })
  ipcMain.on(CALL.previewWindowClose, (e, animate: unknown) => {
    const w = owner(e.sender)
    if (w) previewWindows.close(w, animate !== false)
  })
}

/** The tear's IPC: from the source page (tear, end, the e2e's pointer) and
 *  from the floating one (it has drawn the tab). A spare never starts one. */
export function registerTearIpc(tear: Tear): void {
  ipcMain.handle(CALL.tabTear, (e, req: unknown) => {
    const r = windows.of(e.sender)
    if (!r || r.spare || r.win.isDestroyed() || !validTearRequest(req)) return false
    return tear.start(r.win, req)
  })
  // A drop brings the tab as it is now (packed at the drop, owner
  // 2026-10-30: the source kept it on screen all through the drag).
  ipcMain.handle(CALL.tabTearEnd, (e, how: unknown, carry: unknown) => {
    const r = windows.of(e.sender)
    if (!r || (how !== 'drop' && how !== 'cancel')) return { committed: false }
    return tear.end(r.win, how, validCarry(carry) ? carry : undefined)
  })
  ipcMain.on(CALL.tabTearPoint, (e, p: unknown) => {
    const r = windows.of(e.sender)
    if (E2E && r && isPoint(p)) tear.point(r.win, p)
  })
  ipcMain.on(CALL.tabAdopted, (e, _id: unknown, tab: unknown) => {
    const r = windows.of(e.sender)
    if (r) tear.adopted(r.win, isPoint(tab) ? tab : null)
  })
  // Step 4: every window's strip, for the hit test, and the slot a strip has
  // open for a tab hovering over it.
  ipcMain.on(CALL.tabStrip, (e, report: unknown) => {
    const r = windows.of(e.sender)
    if (r) r.strip = validStripReport(report) ? report : null
  })
  ipcMain.on(CALL.tabHoverSlot, (e, id: unknown, slot: unknown) => {
    const r = windows.of(e.sender)
    if (r && typeof id === 'string' && typeof slot === 'number') tear.slot(r.win, id, slot)
  })
}
