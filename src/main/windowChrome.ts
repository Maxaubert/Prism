import { shell, screen, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { CALL, PUSH } from '@shared/channels'
import { readFileSync } from 'fs'
import { borderColourForWindow, hwndOf, setBorder, setCornersRounded } from './dwmHelper'
import { restoredWindow, type WindowState } from './windowSize'
import { latestWriter } from './latestWrite'
import { userPaths } from './paths'
import { E2E, appState } from './appState'

// THE WINDOW'S CHROME (stage 9c of the structure cleanup, 2026-10-12, out of
// index.ts): where the window was last time, its translucency and the
// borderless fullscreen, the DWM border, bringing it forward, and the
// window:* messages the title bar and the player send. The window itself is
// `appState.mainWindow`; index.ts builds it and calls in here.

/**
 * Where the window was last time.
 *
 * Every launch opened at 1180x780 wherever Windows felt like putting it, so
 * anyone who wanted it bigger resized it again on every single file they opened.
 * The state is one small file in userData: size, position, and whether it was
 * maximised. What comes back is decided in windowSize.ts: File Explorer's size
 * until the user drags it, and never maximised (owner, 2026-10-11).
 *
 * It is checked against the displays actually attached before it is used. A
 * window remembered on a second monitor that is no longer there would otherwise
 * open somewhere nobody can reach it.
 */
/** What is saved: the un-maximised bounds, and whether it was maximised (written, never
 *  restored since 2026-10-11; see windowSize.ts). */
interface SavedWindow extends WindowState {
  maximised?: boolean
}

const WINDOW_STATE = userPaths.windowState

export function readWindowState(): WindowState {
  let saved: unknown = null
  try {
    // sync-ok: startup, the size is needed before the BrowserWindow is built
    saved = JSON.parse(readFileSync(WINDOW_STATE(), 'utf8'))
  } catch {
    /* no file yet, or one written by something else */
  }
  return restoredWindow(saved, screen.getAllDisplays(), screen.getPrimaryDisplay().workArea)
}

/** Save on a delay: a drag fires this continuously, and the disk does not need
 *  to hear about every pixel of it. The write is the tab strip's kind (owner,
 *  2026-10-12, the 3.9 s tabs.json freeze): off main, swapped in whole, newest
 *  last. */
const windowStateFile = latestWriter(WINDOW_STATE)
export function watchWindowState(win: BrowserWindow, flushTabs: () => void): void {
  let timer: NodeJS.Timeout | null = null
  const save = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      if (win.isDestroyed() || win.isMinimized()) return
      // getNormalBounds is the un-maximised size, which is what should come back
      // when the window is restored.
      const b = win.getNormalBounds()
      const state: SavedWindow = { ...b, maximised: win.isMaximized() }
      void windowStateFile.write(JSON.stringify(state))
    }, 400)
  }
  // Listed one by one: BrowserWindow's overloads are per event name, so a loop
  // over a union of them has no single signature to match.
  win.on('resize', save)
  win.on('move', save)
  win.on('maximize', save)
  win.on('unmaximize', save)
  win.on('close', save)
  win.on('close', flushTabs)
  // Every route out of the window ends here: the title bar's X, Alt+F4, the
  // taskbar, Escape. Unsaved text stops all of them until the user answers.
  win.on('close', (e) => {
    if (!appState.editorDirty || appState.closeConfirmed) return
    e.preventDefault()
    win.webContents.send(PUSH.appAskClose)
    // A minimised or background window can't show its own dialog usefully.
    if (win.isMinimized()) win.restore()
    if (!E2E) win.focus()
  })
}

/**
 * The window's translucency, and why fullscreen takes it away (2026-08-25).
 *
 * An acrylic or mica style makes the WINDOW transparent - DWM composites the
 * material behind it, which CSS cannot do - and a transparent window is not
 * a normal window to present video into. Measured here: a few seconds into
 * fullscreen playback the transport stopped reaching the screen while the DOM
 * insisted it was painted, which is what a picture presented outside the
 * page's own layer looks like.
 *
 * Fullscreen has nothing behind it to show through anyway, so the window goes
 * opaque for the duration and the style comes back on the way out.
 */
let wantedMaterial: { material: string; light?: boolean } = { material: 'none' }

/**
 * A fullscreen transition is in flight, so hold the window OPAQUE (2026-09-02).
 *
 * THE ONE-FRAME FLASH. A translucent style sets the window background to
 * `#00000000` - genuinely transparent, because DWM composites the material
 * behind it - and `applyMaterial(true)` only made it opaque on
 * `enter-full-screen`, which fires once the resize is already under way. For a
 * single frame the window has grown but the page has not painted the new area,
 * and with nothing behind it that gap is the DESKTOP. Caught on video and
 * measured: one frame in sixteen of black, a 15px border of flat #ababab going
 * in and a blue-grey strip coming out - two different colours because it was
 * two different bits of wallpaper.
 *
 * The renderer already fades to black for 150ms before it calls
 * requestFullscreen, so it says so first and main goes opaque inside that fade,
 * where nothing can be seen changing. It stays opaque until the fade on the far
 * side has lifted.
 */
let fsTransition = false
/**
 * BORDERLESS FULLSCREEN (2026-09-02), and why the OS one is not used.
 *
 * Windows animates a real fullscreen change, and for ONE FRAME it composites
 * the window at its OLD bounds - so the desktop and the taskbar show in the
 * gap, which is the white frame. Read off the owner's recording: in a video
 * where the taskbar is hidden for all 563 frames it is VISIBLE on exactly one,
 * and that one is the flash. Nothing of ours can paint it, because the gap is
 * outside the window.
 *
 * So the OS is never asked. The window is simply moved to cover the display and
 * put above the taskbar - no `setFullScreen`, no `requestFullscreen`, no
 * animation to have a stale frame in. Covering the display FIRST and then also
 * going fullscreen was tried and is worse than either: it improved the flash
 * and broke the viewer, because two resizes land on top of one another.
 *
 * What is given up: `document.fullscreenElement`, and with it the `:fullscreen`
 * CSS hook and Chromium's native Escape. App owns Escape already and tracks the
 * state from this IPC, so both are covered.
 */
let preFsBounds: Electron.Rectangle | null = null
/** MAXIMIZED IS A STATE, NOT A SIZE (2026-09-03). `setBounds` on a maximized
 *  window is ignored by Windows - verified by sending F11 to one: the window
 *  answered `IsZoomed: true` with its bottom still at the work area's edge,
 *  taskbar showing, which is exactly "it's more like window maximized" as the
 *  owner put it. So the state is dropped before the bounds are set, and put
 *  back on the way out instead of restoring a rectangle. */
let preFsMaximized = false
export const isFs = (): boolean => !!preFsBounds

export function applyMaterial(fullscreen: boolean): void {
  // Borderless counts: there is nothing behind a window covering the screen.
  fullscreen = fullscreen || !!preFsBounds
  if (!appState.mainWindow) return
  const { material, light } = wantedMaterial
  const solid = light ? '#f7f7f9' : '#111318'
  try {
    if (fullscreen || fsTransition || material === 'none') {
      appState.mainWindow.setBackgroundColor(solid)
      appState.mainWindow.setBackgroundMaterial('none')
    } else {
      appState.mainWindow.setBackgroundColor('#00000000')
      appState.mainWindow.setBackgroundMaterial(material as 'acrylic' | 'mica' | 'tabbed')
    }
  } catch {
    /* older Windows: the solid background stands */
  }
  // Chromium rewrites DWM window attributes when the backdrop changes, which
  // silently restores the 1px border this app strips (measured: the strip at
  // ready-to-show read back as default once the theme handshake had run). So
  // Remove it immediately as well as after the rewrite. Waiting for the
  // debounce alone leaves a visible edge during the fullscreen fade.
  applyDwmBorder()
  if (borderStrip) clearTimeout(borderStrip)
  borderStrip = setTimeout(() => {
    borderStrip = null
    applyDwmBorder()
  }, 80)
}
let borderStrip: NodeJS.Timeout | null = null

/**
 * Bring the window genuinely forward (2026-08-28).
 *
 * `show()` and `focus()` ask, and Windows' foreground lock is allowed to
 * refuse: a process that did not have the foreground gets its window drawn
 * but not activated, and then the user's FIRST CLICK is spent activating it
 * instead of pressing what it landed on. That is what "I clicked the tab and
 * nothing happened, then a second later it worked" is.
 *
 * The brief always-on-top is the documented way past the lock, and it is
 * dropped in the same breath, so the window does not stay above others.
 */
export function raise(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  win.show()
  if (E2E) return
  const wasOnTop = win.isAlwaysOnTop()
  win.setAlwaysOnTop(true)
  win.focus()
  win.setAlwaysOnTop(wasOnTop)
}

/**
 * THE DWM BORDER FOLLOWS THE WINDOW'S STATE (2026-09-03, owner). Windows 11
 * draws a 1px border on every framed window; with the title bar hidden it
 * lies as a hairline across the top. RESTORED, the owner wants it - a floating
 * window reads better with an edge. MAXIMIZED or FULLSCREEN it is a hairline
 * across the top of the screen and goes (dwmapi attribute 34, COLOR_NONE).
 * Purely cosmetic, so a failure costs nothing but the hairline. Chromium
 * rewrites DWM attributes when the backdrop changes, so applyDwmBorder also
 * rides behind every material application.
 *
 * QUIETER THAN DWM'S OWN (owner, same day: "a bit too thick"). The border is
 * always one physical pixel; what reads as thickness is contrast, so it is
 * drawn in a colour a step off the window's own ground rather than in DWM's
 * default grey. And it lands the moment the state changes, through the
 * persistent helper in dwmHelper.ts - a fresh PowerShell per change paid a
 * two-second compile, which is why the edge used to arrive two seconds after
 * the window did.
 */
export function applyDwmBorder(): void {
  const win = appState.mainWindow
  if (!win) return
  try {
    const hwnd = hwndOf(win.getNativeWindowHandle())
    setBorder(
      hwnd,
      borderColourForWindow({
        maximized: win.isMaximized(),
        fullscreen: isFs(),
        transitioning: fsTransition,
        light: !!wantedMaterial.light
      })
    )
  } catch {
    /* cosmetic */
  }
}

/**
 * The window:* messages, registered once (never per window: a rebuilt window,
 * #265, would add a second listener), in the order index.ts always had them.
 */
export function registerWindowIpc(): void {
  ipcMain.on(CALL.windowMinimize, () => appState.mainWindow?.minimize())
  ipcMain.on(CALL.windowToggleMaximize, () =>
    appState.mainWindow?.isMaximized()
      ? appState.mainWindow.unmaximize()
      : appState.mainWindow?.maximize()
  )
  // Closing with unsaved text asks first. The renderer keeps `editorDirty`
  // current, so the common (clean) path closes with no round trip; only a
  // dirty buffer costs a question. `force` is the renderer saying the user
  // already answered it.
  ipcMain.on(CALL.editorDirty, (_e, d: boolean) => {
    appState.editorDirty = !!d
  })
  ipcMain.on(CALL.windowClose, (_e, force?: boolean) => {
    if (force) appState.closeConfirmed = true
    appState.mainWindow?.close()
  })
  /**
   * BORDERLESS FULLSCREEN, NO TOPMOST (2026-09-03, third design).
   *
   * Real OS fullscreen is VISIBLY ANIMATED by DWM and the tail of that
   * animation escapes any in-window veil - the owner saw the white frame on
   * both ways with it. Borderless WITH always-on-top looked perfect going
   * in but lost the taskbar war: Windows strips WS_EX_TOPMOST from a window
   * it takes for fullscreen (measured: the bit held 0.3-3s, then dropped
   * while Electron still said true) and the taskbar redrew over the picture.
   *
   * The answer is what borderless-windowed games do: NOTHING. A foreground
   * window covering its monitor trips the shell's own fullscreen detection
   * (SHQueryUserNotificationState flips to QUNS_BUSY the moment the cover
   * lands - measured, overhang and all) and the shell puts the taskbar
   * beneath it. It was the TOPMOST bit that kept that path from engaging.
   * setResizable(false) does NOT shrink the frame overhang (measured, the
   * rect stays ~6px proud) - it is here so the screen's edges are not live
   * resize handles while the picture is up.
   *
   * The way OUT: win.maximize() from the covering bounds runs DWM's
   * maximize animation, which paints a default frame - the owner's exit
   * flash. Setting the work-area bounds first makes that animation
   * degenerate: same rect to same rect, nothing to draw.
   */
  /**
   * THE SHROUD FADES (2026-09-03, after the owner's recording). The
   * in-window veil cannot touch the taskbar or the desktop around a
   * windowed app, so however well the window fades, the SURROUNDINGS
   * snapped: the taskbar cut to black on the way in and popped back a
   * frame early on the way out - both visible in the recording. The shroud
   * is a plain black window over the whole display, and it FADES on the
   * same clock as the veil: raised when the renderer says a transition has
   * begun (fs-transition true, which fires before anything moves), black
   * before the swap arrives, and faded out when the renderer starts
   * lifting. The window transform happens under it; the taskbar now fades
   * with everything else. Its brief always-on-top is safe - the strip
   * Windows applies to topmost fullscreen-sized windows took 300ms-3s to
   * land, measured, and the shroud lives under a second. A 2.5s watchdog
   * lifts it no matter what, because a stuck black screen is the one
   * failure worse than any flash.
   */
  let fsShroud: BrowserWindow | null = null
  let shroudAnim: NodeJS.Timeout | null = null
  let shroudSafety: NodeJS.Timeout | null = null
  const shroudTo = (target: number, ms: number, done?: () => void): void => {
    const w = fsShroud
    if (!w || w.isDestroyed()) return
    if (shroudAnim) clearInterval(shroudAnim)
    const from = w.getOpacity()
    const t0 = Date.now()
    shroudAnim = setInterval(() => {
      const k = Math.min(1, (Date.now() - t0) / ms)
      try {
        if (!w.isDestroyed()) w.setOpacity(from + (target - from) * k)
      } catch {
        /* gone is gone */
      }
      if (k >= 1 && shroudAnim) {
        clearInterval(shroudAnim)
        shroudAnim = null
        done?.()
      }
    }, 16)
  }
  const shroudLift = (): void => {
    if (shroudSafety) clearTimeout(shroudSafety)
    shroudSafety = null
    shroudTo(0, 280, () => {
      try {
        fsShroud?.hide()
      } catch {
        /* gone is gone */
      }
    })
  }
  const shroudRaise = (): void => {
    if (E2E) return // it would cover the REAL display while the suite runs parked
    const win = appState.mainWindow
    if (!win) return
    try {
      if (!fsShroud || fsShroud.isDestroyed()) {
        fsShroud = new BrowserWindow({
          show: false,
          frame: false,
          // Keep Electron's default thick frame. Disabling it on this
          // opacity-animated cover switches Chromium to software compositing
          // and stalls hardware-decoded HEVC. Strip the visible edge via DWM.
          roundedCorners: false,
          backgroundColor: '#000000',
          skipTaskbar: true,
          focusable: false,
          resizable: false,
          movable: false,
          minimizable: false,
          maximizable: false,
          hasShadow: false
        })
        fsShroud.setIgnoreMouseEvents(true)
        fsShroud.setMenu(null)
      }
      const shroud = fsShroud
      // The fading cover is itself a native window. Its frame must never
      // outline the display while the main window changes maximize state.
      setBorder(hwndOf(shroud.getNativeWindowHandle()), 'none')
      if (!shroud.isVisible()) shroud.setOpacity(0)
      shroud.setBounds(screen.getDisplayMatching(win.getBounds()).bounds)
      shroud.setAlwaysOnTop(true, 'screen-saver')
      shroud.showInactive()
      shroudTo(1, 150)
    } catch {
      return // a failed shroud only costs the cover, not the swap
    }
    if (shroudSafety) clearTimeout(shroudSafety)
    shroudSafety = setTimeout(shroudLift, 2500)
  }
  ipcMain.on(CALL.windowFsShroud, (_e, up: boolean) => (up ? shroudRaise() : shroudLift()))
  /**
   * SQUARE CORNERS WHILE FULLSCREEN (2026-09-03). Windows 11 rounds every
   * top-level window, and a borderless cover is still just a window - the
   * corner cut-outs showed the desktop as grey arcs (the owner's own
   * screenshot). Electron 43 exposes rounding only as a constructor option
   * and only for frameless windows, so the DWM attribute is set directly:
   * corner preference (33), DONOTROUND going in, DEFAULT coming back,
   * through the persistent helper in dwmHelper.ts so it lands in
   * milliseconds under the shroud. The 1px DWM BORDER is not handled here:
   * it follows the window's state - see applyDwmBorder.
   */
  const setCorners = (rounded: boolean): void => {
    const win = appState.mainWindow
    if (!win) return
    try {
      setCornersRounded(hwndOf(win.getNativeWindowHandle()), rounded)
    } catch {
      /* rounded corners are cosmetic; the swap must not fail over them */
    }
  }
  ipcMain.on(CALL.windowSetFullscreen, (_e, on: boolean) => {
    const win = appState.mainWindow
    if (!win || !!on === isFs()) return
    try {
      if (on) {
        preFsBounds = win.getBounds()
        preFsMaximized = win.isMaximized()
        const disp = screen.getDisplayMatching(preFsBounds)
        if (preFsMaximized) win.unmaximize()
        win.setResizable(false)
        win.setBounds(disp.bounds)
        setCorners(false)
      } else {
        const back = preFsBounds
        preFsBounds = null
        const disp = screen.getDisplayMatching(back ?? win.getBounds())
        win.setResizable(true)
        setCorners(true)
        if (preFsMaximized) {
          win.setBounds(disp.workArea)
          win.maximize()
        } else if (back) {
          win.setBounds(back)
        }
        preFsMaximized = false
        // The edge comes back WITH the window, not on the material
        // debounce behind it (owner: it used to arrive seconds late).
        applyDwmBorder()
      }
    } catch {
      preFsBounds = on ? preFsBounds : null
    }
    applyMaterial(isFs())
    win.webContents.send(PUSH.windowFullscreen, isFs())
  })
  // Windows 11 composites acrylic and mica behind the window; CSS can't, since
  // backdrop-filter only sees the app's own pixels. The window background has
  // to go transparent for the material to show through.
  // Windows does not let an app take file associations on its own, and that is
  // the right way round: this opens the list with Prism in it and the choice
  // stays the user's.
  ipcMain.on(CALL.appDefaultApps, () => {
    // Windows 11 takes a deep link straight to Prism's own page in Default
    // apps, where each file type is one click. The app cannot set them
    // itself: the choice lives in a signed UserChoice key precisely so that
    // no installer can help itself to it. Older builds ignore the query and
    // land on the list, which is still the right list.
    // Never under --e2e (#222): a test run must not open Windows Settings.
    if (!E2E) void shell.openExternal('ms-settings:defaultapps?registeredAppUser=Prism')
  })
  // The renderer's fade brackets the whole swap: opaque on the way in, and the
  // material comes back only once the far side has been painted and lifted.
  // Registered once here, not per window: a rebuilt window (#265) would add
  // a second listener.
  ipcMain.on(CALL.windowFsTransition, (_e, active: boolean) => {
    fsTransition = !!active
    applyMaterial(!!appState.mainWindow?.isFullScreen())
  })
  ipcMain.on(CALL.windowMaterial, (_e, material: string, mode?: string) => {
    if (!appState.mainWindow) return
    const light = mode === 'light'
    wantedMaterial = { material, light }
    try {
      // DWM decides whether its blur is a light or a dark frost from the
      // window's immersive theme, which Electron drives off nativeTheme. Told
      // nothing, a light acrylic style gets a dark frost under white surfaces.
      nativeTheme.themeSource = light ? 'light' : 'dark'
      // Fullscreen keeps the window opaque whatever the style asks for.
      applyMaterial(appState.mainWindow.isFullScreen())
    } catch {
      /* older Windows, or an unsupported value: the solid background stands */
    }
  })
}
