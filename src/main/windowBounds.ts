import type { SavedBounds } from './session'

/** The part of a BrowserWindow the bounds watch reads. Kept this small so
 *  the close-time rule (#25) is tested without Electron. */
export interface BoundsWindow {
  // One overload per event, as BrowserWindow declares them, so a real window
  // is one of these.
  on(event: 'resize', listener: () => void): unknown
  on(event: 'move', listener: () => void): unknown
  on(event: 'maximize', listener: () => void): unknown
  on(event: 'unmaximize', listener: () => void): unknown
  on(event: 'close', listener: () => void): unknown
  isDestroyed(): boolean
  isMinimized(): boolean
  isMaximized(): boolean
  getNormalBounds(): { x: number; y: number; width: number; height: number }
}

/** The wait after a move or resize before it is reported: a drag fires
 *  continuously, and the disk does not need to hear about every pixel. */
export const BOUNDS_SETTLE_MS = 400

/**
 * Report a window's size and place: once a drag settles, and AT ONCE on
 * close (#25, 2026-11-01). The close cancels the wait and reports right
 * away, so a close inside those 400 ms still keeps the last drag; the wait
 * never reports again after the window has gone. A minimised window's bounds
 * are not a place and are never reported. `windowBounds.test.ts` holds it.
 */
export function watchBounds(win: BoundsWindow, report: (bounds: SavedBounds) => void): void {
  let timer: NodeJS.Timeout | null = null
  const now = (): void => {
    if (win.isDestroyed() || win.isMinimized()) return
    // getNormalBounds is the un-maximised size, which is what should come back
    // when the window is restored.
    report({ ...win.getNormalBounds(), maximised: win.isMaximized() })
  }
  const later = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(now, BOUNDS_SETTLE_MS)
  }
  win.on('resize', later)
  win.on('move', later)
  win.on('maximize', later)
  win.on('unmaximize', later)
  win.on('close', () => {
    if (timer) clearTimeout(timer)
    timer = null
    now()
  })
}
