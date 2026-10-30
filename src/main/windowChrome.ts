import { shell, screen, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { CALL, PUSH } from '@shared/channels'
import { readFileSync } from 'fs'
import { borderColourForWindow, hwndOf, setBorder, setCornersRounded } from './dwmHelper'
import { restoredWindow, type WindowState } from './windowSize'
import { userPaths } from './paths'
import { E2E, windows } from './appState'
import type { SavedBounds } from './session'

// THE WINDOW'S CHROME (stage 9c of the structure cleanup, 2026-10-12, out of
// index.ts): where the window was last time, its translucency and the
// borderless fullscreen, the DWM border, bringing it forward, and the
// window:* messages the title bar and the player send. index.ts builds the
// windows and calls in here.
//
// EVERY WINDOW ITS OWN (tab tear-off step 1, 2026-10-29): each window:*
// message acts on the window whose page SENT it, never on "the" window, and
// the fullscreen and transition state is kept per window (`chromeOf`). The
// theme is one for the app: a change re-applies the material to every window.

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
const WINDOW_STATE = userPaths.windowState

/**
 * The size and place of the session's first window: the session file's own
 * bounds (2026-10-29, one entry per window), else window-state.json, which is
 * where an older Prism kept them (read, never written any more).
 */
export function readWindowState(sessionBounds: SavedBounds | null): WindowState {
  let saved: unknown = sessionBounds
  if (!saved)
    try {
      // sync-ok: startup, the size is needed before the BrowserWindow is built
      saved = JSON.parse(readFileSync(WINDOW_STATE(), 'utf8'))
    } catch {
      /* no file yet, or one written by something else */
    }
  return restoredWindow(saved, screen.getAllDisplays(), screen.getPrimaryDisplay().workArea)
}

/** Save on a delay: a drag fires this continuously, and the disk does not need
 *  to hear about every pixel of it. The bounds go into the window's own entry
 *  of the session file (`report`), written off main like the tab strip. */
export function watchWindowState(
  win: BrowserWindow,
  report: (bounds: SavedBounds) => void,
  flush: () => void
): void {
  let timer: NodeJS.Timeout | null = null
  const save = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      if (win.isDestroyed() || win.isMinimized()) return
      // getNormalBounds is the un-maximised size, which is what should come back
      // when the window is restored.
      report({ ...win.getNormalBounds(), maximised: win.isMaximized() })
    }, 400)
  }
  // Listed one by one: BrowserWindow's overloads are per event name, so a loop
  // over a union of them has no single signature to match.
  win.on('resize', save)
  win.on('move', save)
  win.on('maximize', save)
  win.on('unmaximize', save)
  win.on('close', () => {
    if (timer) clearTimeout(timer)
    timer = null
    if (!win.isDestroyed() && !win.isMinimized()) report({ ...win.getNormalBounds(), maximised: win.isMaximized() })
  })
  win.on('close', flush)
  // Every route out of the window ends here: the title bar's X, Alt+F4, the
  // taskbar, Escape. Unsaved text stops all of them until the user answers.
  // THIS window's text and THIS window's answer (2026-10-29): another
  // window's "discard" never lets this one's unsaved text through.
  win.on('close', (e) => {
    const r = windows.recordOf(win)
    if (!r?.dirty || r.closeConfirmed) return
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
/**
 * Each window's own share of the state described here and below (2026-10-29):
 * its transition, its borderless-fullscreen bounds and maximize, and its
 * border strip's timer. A WeakMap, so a closed window takes its own with it.
 */
interface WindowChrome {
  fsTransition: boolean
  preFsBounds: Electron.Rectangle | null
  preFsMaximized: boolean
  borderStrip: NodeJS.Timeout | null
}
const chrome = new WeakMap<BrowserWindow, WindowChrome>()
function chromeOf(win: BrowserWindow): WindowChrome {
  let c = chrome.get(win)
  if (!c) chrome.set(win, (c = { fsTransition: false, preFsBounds: null, preFsMaximized: false, borderStrip: null }))
  return c
}
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
 *
 * MAXIMIZED IS A STATE, NOT A SIZE (2026-09-03). `setBounds` on a maximized
 * window is ignored by Windows - verified by sending F11 to one: the window
 * answered `IsZoomed: true` with its bottom still at the work area's edge,
 * taskbar showing, which is exactly "it's more like window maximized" as the
 * owner put it. So the state is dropped before the bounds are set
 * (`preFsMaximized`), and put back on the way out instead of restoring a
 * rectangle. Both are per window (`chromeOf`).
 */
export const isFs = (win: BrowserWindow): boolean => !!chromeOf(win).preFsBounds

export function applyMaterial(win: BrowserWindow, fullscreen: boolean): void {
  if (win.isDestroyed()) return
  const c = chromeOf(win)
  // Borderless counts: there is nothing behind a window covering the screen.
  fullscreen = fullscreen || !!c.preFsBounds
  const { material, light } = wantedMaterial
  const solid = light ? '#f7f7f9' : '#111318'
  try {
    if (fullscreen || c.fsTransition || material === 'none') {
      win.setBackgroundColor(solid)
      win.setBackgroundMaterial('none')
    } else {
      win.setBackgroundColor('#00000000')
      win.setBackgroundMaterial(material as 'acrylic' | 'mica' | 'tabbed')
    }
  } catch {
    /* older Windows: the solid background stands */
  }
  // Chromium rewrites DWM window attributes when the backdrop changes, which
  // silently restores the 1px border this app strips (measured: the strip at
  // ready-to-show read back as default once the theme handshake had run). So
  // Remove it immediately as well as after the rewrite. Waiting for the
  // debounce alone leaves a visible edge during the fullscreen fade.
  applyDwmBorder(win)
  if (c.borderStrip) clearTimeout(c.borderStrip)
  c.borderStrip = setTimeout(() => {
    c.borderStrip = null
    applyDwmBorder(win)
  }, 80)
}

/** The solid ground of the current theme: what a new window paints before its
 *  page has (the tear-off's spare, step 3), so it never flashes another colour. */
export const themeGround = (): string => (wantedMaterial.light ? '#f7f7f9' : '#111318')

/** The theme is the app's: a new one reaches every window at once. */
function applyMaterialEverywhere(): void {
  for (const r of windows.all()) applyMaterial(r.win, r.win.isFullScreen())
}

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
export function applyDwmBorder(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  try {
    const hwnd = hwndOf(win.getNativeWindowHandle())
    setBorder(
      hwnd,
      borderColourForWindow({
        maximized: win.isMaximized(),
        fullscreen: isFs(win),
        transitioning: chromeOf(win).fsTransition,
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
  // The window whose page sent it (2026-10-29): a second window's X, its
  // minimise and its F11 act on that window, never on the first.
  const own = (e: Electron.IpcMainEvent): BrowserWindow | null => windows.windowOf(e.sender)
  ipcMain.on(CALL.windowMinimize, (e) => own(e)?.minimize())
  ipcMain.on(CALL.windowToggleMaximize, (e) => {
    const win = own(e)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  // Closing with unsaved text asks first. The renderer keeps its window's
  // dirty flag current, so the common (clean) path closes with no round
  // trip; only a dirty buffer costs a question. `force` is the renderer
  // saying the user already answered it, for ITS window.
  ipcMain.on(CALL.editorDirty, (e, d: boolean) => {
    const r = windows.of(e.sender)
    if (r) r.dirty = !!d
  })
  ipcMain.on(CALL.windowClose, (e, force?: boolean) => {
    const r = windows.of(e.sender)
    if (!r || r.win.isDestroyed()) return
    if (force) r.closeConfirmed = true
    r.win.close()
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
  // One shroud for the app, raised on the display of the window that asked.
  const shroudRaise = (win: BrowserWindow | null): void => {
    if (E2E) return // it would cover the REAL display while the suite runs parked
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
  ipcMain.on(CALL.windowFsShroud, (e, up: boolean) => (up ? shroudRaise(own(e)) : shroudLift()))
  // THE SHROUD NEVER KEEPS THE APP ALIVE (2026-10-29). It is a BrowserWindow,
  // hidden rather than closed between uses, and a hidden window still counts
  // against `window-all-closed`: once fullscreen had been used, closing the
  // last Prism window could leave a process with nothing on screen. It goes
  // when the last page window does (index.ts).
  destroyShroud = (): void => {
    if (shroudAnim) clearInterval(shroudAnim)
    if (shroudSafety) clearTimeout(shroudSafety)
    shroudAnim = null
    shroudSafety = null
    const w = fsShroud
    fsShroud = null
    try {
      if (w && !w.isDestroyed()) w.destroy()
    } catch {
      /* gone is gone */
    }
  }
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
  const setCorners = (win: BrowserWindow, rounded: boolean): void => {
    try {
      setCornersRounded(hwndOf(win.getNativeWindowHandle()), rounded)
    } catch {
      /* rounded corners are cosmetic; the swap must not fail over them */
    }
  }
  ipcMain.on(CALL.windowSetFullscreen, (e, on: boolean) => {
    const win = own(e)
    if (!win || !!on === isFs(win)) return
    const c = chromeOf(win)
    try {
      if (on) {
        c.preFsBounds = win.getBounds()
        c.preFsMaximized = win.isMaximized()
        const disp = screen.getDisplayMatching(c.preFsBounds)
        if (c.preFsMaximized) win.unmaximize()
        win.setResizable(false)
        win.setBounds(disp.bounds)
        setCorners(win, false)
      } else {
        const back = c.preFsBounds
        c.preFsBounds = null
        const disp = screen.getDisplayMatching(back ?? win.getBounds())
        win.setResizable(true)
        setCorners(win, true)
        if (c.preFsMaximized) {
          win.setBounds(disp.workArea)
          win.maximize()
        } else if (back) {
          win.setBounds(back)
        }
        c.preFsMaximized = false
        // The edge comes back WITH the window, not on the material
        // debounce behind it (owner: it used to arrive seconds late).
        applyDwmBorder(win)
      }
    } catch {
      c.preFsBounds = on ? c.preFsBounds : null
    }
    applyMaterial(win, isFs(win))
    win.webContents.send(PUSH.windowFullscreen, isFs(win))
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
  ipcMain.on(CALL.windowFsTransition, (e, active: boolean) => {
    const win = own(e)
    if (!win) return
    chromeOf(win).fsTransition = !!active
    applyMaterial(win, win.isFullScreen())
  })
  ipcMain.on(CALL.windowMaterial, (e, material: string, mode?: string) => {
    if (!own(e)) return
    const light = mode === 'light'
    wantedMaterial = { material, light }
    try {
      // DWM decides whether its blur is a light or a dark frost from the
      // window's immersive theme, which Electron drives off nativeTheme. Told
      // nothing, a light acrylic style gets a dark frost under white surfaces.
      nativeTheme.themeSource = light ? 'light' : 'dark'
      // Fullscreen keeps a window opaque whatever the style asks for. Every
      // window: the theme is the app's, whichever window changed it.
      applyMaterialEverywhere()
    } catch {
      /* older Windows, or an unsupported value: the solid background stands */
    }
  })
}

/** The shroud's teardown, once `registerWindowIpc` has made it (see there). */
let destroyShroud = (): void => {}
export const releaseShroud = (): void => destroyShroud()
