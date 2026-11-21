import { BrowserWindow } from 'electron'
import { E2E, windows } from '../appState'
import { browseWatcherOf } from '../browseWatch'
import { desktopClosed } from '../desktopAccess'
import type { WindowOptions } from '../windowOptions'
import type { createTabGhost } from '../tabGhost'
import type { createTearOff } from '../tearOff'
import type { Point } from '@shared/tabTear'

/** The e2e's hooks on the windows (audit #7 step 2), moved whole: nothing under a normal run. */
export function installE2eWindowHooks(deps: {
  createWindow: (options?: WindowOptions) => BrowserWindow
  tear: ReturnType<typeof createTearOff<BrowserWindow>>
  tabGhost: ReturnType<typeof createTabGhost<BrowserWindow>>
}): void {
  const { createWindow, tear, tabGhost } = deps
  // E2E only (tab tear-off step 1, 2026-10-29): the scenarios open a second
  // window the way main makes any later one, find the session's FIRST
  // window whatever order Electron lists them in (`getAllWindows()[0]` is
  // no promise), and read what main still holds for a tab after its
  // window has closed.
  if (E2E)
    Object.assign(globalThis, {
      __e2eOpenWindow: (): number => createWindow({ seed: { kind: 'none' } }).id,
      __e2eMainWindow: (): BrowserWindow | null =>
        (windows.all().find((r) => r.first) ?? windows.oldest())?.win ?? null,
      // The session's windows: the tear-off's spare is not one (`__e2eTear`).
      __e2eWindows: () =>
        windows
          .all()
          .filter((r) => !r.spare)
          .map((r) => ({
            id: r.win.id,
            page: r.id,
            key: r.key,
            first: r.first,
            winE: r.winE,
            dirty: r.dirty,
            restored: r.restored,
            tabs: (r.reported?.tabs ?? []).map((t) => t.id ?? '')
          })),
      __e2eTabHeld: (tabId: string) => ({
        released: desktopClosed(tabId),
        watching: !!browseWatcherOf(tabId)
      }),
      // The tear-off (step 3): its phase, where the moving window WOULD be
      // (nothing moves under --e2e), its counts, and the spare.
      __e2eTear: () => {
        const s = windows.spare()
        return {
          ...tear.state(),
          spare: s
            ? {
                page: s.id,
                key: s.key,
                ready: s.restored,
                visible: !s.win.isDestroyed() && s.win.isVisible()
              }
            : null,
          // The ghost's own window (owner, 2026-10-30): made, loaded, shown
          // (parked and clear), and where it would be.
          ghostWin: tabGhost.state()
        }
      },
      // The label the ghost's page shows, read back from its document.
      __e2eGhostLabel: () => tabGhost.label(),
      // Step 4: where a parked window pretends to be (an offset from the
      // work area's top-left, so it can be a target), a focus order (the
      // e2e's windows are unfocusable, so none is ever focused by itself),
      // and the strip a window reported.
      __e2eTearAt: (id: number, at: Point | null) => {
        const w = BrowserWindow.fromId(id)
        if (w) tear.e2eAt(w, at)
      },
      __e2eFocused: (id: number) => {
        const w = BrowserWindow.fromId(id)
        if (w) windows.focused(w)
      },
      __e2eStrip: (id: number) => {
        const w = BrowserWindow.fromId(id)
        return w ? (windows.recordOf(w)?.strip ?? null) : null
      }
    })
}
