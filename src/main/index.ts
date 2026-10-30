import { startLagProfiler } from './lagProfiler'
import { startNativeTrace } from './nativeTrace'
import { CALL, PUSH } from '@shared/channels'
import {
  app,
  protocol,
  shell,
  screen,
  BrowserWindow,
  ipcMain,
  dialog,
  contentTracing,
  crashReporter,
  utilityProcess,
  Menu,
  powerMonitor,
  powerSaveBlocker,
  session,
  clipboard,
  nativeImage
} from 'electron'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'path'
import { answerE2eClipboard, installFakeClipboard } from './e2eClipboard'
import { existsSync } from 'fs'
import {
  rm,
  stat
} from 'fs/promises'
import { tmpdir } from 'os'
import {
  initDwmHelper
} from './dwmHelper'
import { pathsFromArgv, pathsFromArgvAsync } from './argv'
import { WIN_E_FIRST, browseRequest, createWinERequests, winERequest, winEHostOf } from './winERequests'
import { removeOldExplorerWindows } from './oldExplorerWindows'
import { createWindowPreferences } from './windowPreferences'
import { forgetCanonical, listDir, searchFiles, toViewerFile, warmCanonical } from './dirList'
import {
  desktopClosed,
  grantDesktopDirectory,
  insideDesktop
} from './desktopAccess'
import { browseWatcherOf } from './browseWatch'
import { browseDirectory, browseLocations, browseWatch, type BrowseRead } from './browse'
import { driveUsage, withUsedShare } from './driveUsage'
import { phoneListed, phoneMay, phoneOnThisPc, phoneRelease } from './phone/phoneAccess'
import { phonePlaces } from './phone/places'
import { MemberTemp, cleanDeadRuns, pidAlive } from './memberTemp'
import { createArchiveBrowse } from './archiveBrowse'
import { placeOf } from '@shared/archivePlace'
import { createListingCache } from './listingCache'
import { createExplorerListings } from './explorerListing'
import { isLocalFixed, learnDriveKinds } from './driveKinds'
import { REMEMBER_FOLDERS_KEY } from '@shared/listingPrefs'
import { FolderSizeCache } from './folderSizeCache'
import { getIndexedFolderSizes } from './everythingBrowse'
import { initializeIndexerRuntime, indexerInstance } from './indexerRuntime'
import { findRunningEverything } from './existingEverything'
import { HlsJobs } from './phone/jobs'
import { PhoneLog } from './phone/diag'
import { Positions } from './positions'
import { holders } from './holders'
import { Thumbs } from './thumbs'
import { parseTabs, readSessionRaw, type SavedTabs } from './tabs'
import { savedEntry, type SessionEntry } from './session'
import type { WindowSeed } from './windowRegistry'
import { userPaths } from './paths'
import { startDiagnostics, type Diagnostics } from 'prism-term-core/main/diagnostics'
import { withStackPolicy } from 'prism-term-core/main/diagIpc'
import { LONG_WAIT_CHANNELS } from './diagChannels'
import { diagWindowEvent } from './diagWindow'
import { mainCrumb } from './diagCrumb'
import { initSweepOverlay, loadSweepAddon, sweepDirs, type SweepOverlay } from './sweepOverlay'
import { documentImages } from './docImages'
import { AUDIO_SCHEME, killSidecars, serveSidecarAudio } from './audioSidecar'
import { probeMedia, type MediaInfo } from './ffmpeg'
import { createProbeCache } from './probeCache'
import {
  cancelAllConversions
} from './videoConvert'
import { docKind } from './docConvert'
import { createDocClient } from './docClient'
import { createShellVerbSetting } from './shellVerbSetting'
import { shapeOf, type TextShape } from './textFile'
import { stopAllTails, stopTailsOf } from './fileTail'
import { firstWindow } from './windowSize'
import { readAsVtt, sidecarsFor } from './subtitles'
import {
  setSevenExe,
  setZipFork
} from './archive'
import {
  previewUpdate,
  wantsPreview
} from 'prism-term-core/main/updatePreview'
import { crashBudget } from './crashBudget'
import { appendCrashLog, crashLine, crashLogSettled } from './crashLog'
import { guardWindow, pageGone } from './windowGuard'
import pkg from '../../package.json'
import { fileKind, isMarkdown } from '@shared/fileKind'
import type {
  OpenPayload,
  TextRead
} from '@shared/types'
import { exists } from './fsUtil'
import { E2E, appState, windows } from './appState'
import { createPathWall } from './pathWall'
import { MEDIA_SCHEME, createMediaServer } from './mediaProtocol'
import { heicToJpeg } from './heicClient'
import { ffmpegTools, sevenExe } from './bundledTools'
import { registerArchiveIpc, type ArchiveBodies } from './ipc/archive'
import { registerMediaIpc } from './ipc/media'
import { registerPropsIpc } from './ipc/props'
import { registerBrowseIpc, registerTreeIpc, releaseTab } from './ipc/browse'
import { registerLinkIpc } from './ipc/links'
import { installPermissionHandler } from './permissions'
import {
  registerSaveCopyIpc,
  registerFilesIpc,
  registerShellIpc,
  registerMoveIpc,
  registerNewFilesIpc,
  tailOwner
} from './ipc/files'
import { registerOpenIpc } from './ipc/open'
import { registerPreferencesIpc, registerWinEIpc, registerSessionIpc } from './ipc/window'
import { createTabsSession } from './tabsSession'
import { offerUpdate, startUpdates, updateOffered } from './updateFlow'
import {
  registerPositionsIpc,
  startPhoneService,
  type PhoneHooks,
  type PhoneServerDeps
} from './phone'
import {
  applyDwmBorder,
  applyMaterial,
  raise,
  readWindowState,
  registerWindowIpc,
  releaseShroud,
  themeGround,
  watchWindowState
} from './windowChrome'
import { createTearOff } from './tearOff'
import { TEAR, validStripReport, validTearRequest, type Point } from '@shared/tabTear'

// Prism main process. Phase 0 scaffold: a frameless window, the fsmedia:// media
// protocol (Range-aware so <video>/<audio> can seek), and open-file routing
// (launch argv, single-instance forward, drag-drop, dialog). The viewer itself is
// a placeholder in the renderer until prism-core lands (Phase 1).

// On HDR displays Chromium plays video through a DirectComposition hardware
// overlay whose tone mapping differs from the composited fallback it switches
// to around a paused frame - the picture visibly brightens on pause. Keeping
// every frame on the composited path makes playing and paused identical (at
// the cost of the overlay's punchier HDR mapping during playback).
app.commandLine.appendSwitch('disable-direct-composition-video-overlays')
// ...and the second half of the same bug: on an HDR desktop Windows applies
// its SDR-brightness boost to composited content but not to what rides the
// video pipeline, so the two states of one frame can still differ. Forcing
// the window to one sRGB profile makes Chromium hand Windows the same kind
// of pixels in every state - playing and paused match. The cost: HDR videos
// are tone-mapped to SDR inside Prism rather than passed through.
app.commandLine.appendSwitch('force-color-profile', 'srgb')
// The hammer in the same family, on trial (2026-08-25): with DirectComposition
// off, Chromium cannot hand the picture to Windows to present at all, so
// anything the page draws over the video has to reach the screen the ordinary
// way. If this is what fixes the missing transport, it narrows to the lightest
// switch that still does; if it is not, the fault is not compositing.
app.commandLine.appendSwitch('disable-direct-composition')
/**
 * A film keeps playing when you click away (2026-08-27, from the owner's own
 * log). Windows tells Chromium when another window COVERS this one, Chromium
 * marks the page hidden - `document.hidden` goes true, `visibilitychange`
 * fires - and its hidden-page media policy suspends playback a millisecond
 * later. It resumed on the way back, which is what made it look like a
 * setting rather than a policy:
 *
 *   window focused=false -> visibility hidden=true -> PAUSE, with the app's
 *   own "pause in background" switched OFF the whole time.
 *
 * Occlusion detection exists to save work on windows nobody can see. A media
 * viewer is the case where that is wrong: covered is not closed, and the
 * sound is the point.
 */
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

// THE E2E NEVER TOUCHES THE REAL CLIPBOARD (#356): every clipboard the app
// has is one in memory under --e2e (e2eClipboard.ts).
if (process.argv.includes('--e2e')) {
  installFakeClipboard(clipboard as unknown as Record<string, unknown>, (png) => nativeImage.createFromBuffer(png))
  ipcMain.handle(CALL.e2eClipboard, answerE2eClipboard)
}

// THE E2E'S DOWNLOADS IS A FIXTURE (#285): the `downloadsDate` scenario needs a
// Downloads it can fill with dated files, and must never touch the real one.
// Only under --e2e, and only the one Known Folder.
if (process.argv.includes('--e2e') && process.env.PRISM_E2E_DOWNLOADS)
  app.setPath('downloads', process.env.PRISM_E2E_DOWNLOADS)

/**
 * THE MEMBER TEMP FOLDER (#300, memberTemp.ts): a member opened or previewed
 * from a place inside a zip is unpacked under one folder per run, granted to
 * the reads as a DIRECTORY, never to a write.
 */
const memberTemp = new MemberTemp(join(tmpdir(), 'prism-members'))

/** Where the renderer's own files live. pdf.js fetches its cmaps, standard
 *  fonts, wasm and icc profiles through fsmedia:// (fetch refuses file: URLs
 *  in a packaged build), so the app's OWN asset tree has to be servable - and
 *  the wall refused it, which broke every PDF that does not embed its fonts.
 *  Invisible in dev, where the same data comes over the vite server. */
const RENDERER_DIR = resolve(join(__dirname, '..', 'renderer'))

/**
 * THE ROOT WALL (pathWall.ts): every guard a handler asks, in one module with
 * its own tests. Archive members extracted to temp for viewing are granted
 * one exact path each, when archive:extract writes it; the reads that honour
 * the wall (file:text, file:copy-clip) accept these too, writes never do.
 */
const wall = createPathWall({
  insideDesktop,
  memberOwns: (p) => memberTemp.owns(p),
  rendererDir: RENDERER_DIR
})
const { readable, editable, movable, archiveOk, archiveReadOk, comicOk } = wall

/** fsmedia:// (mediaProtocol.ts), walled by `mediaAllowed`. */
const warmWall = (p: string): Promise<void> => warmCanonical([p, dirname(p)])
const serveMediaNow = createMediaServer({
  allowed: wall.mediaAllowed,
  warm: warmWall,
  ffmpeg: ffmpegTools,
  heic: heicToJpeg
})
// E2E only: a file whose name holds PRISM_E2E_SLOW_MEDIA answers 1.5 s late,
// standing in for a slow conversion (a HEIC), so the preview's wait can be
// seen (e2e previewSlowImage).
const slowMedia = process.argv.includes('--e2e') ? process.env.PRISM_E2E_SLOW_MEDIA : undefined
const serveMedia = slowMedia
  ? async (request: Request): Promise<Response> => {
      if (decodeURIComponent(request.url).includes(slowMedia)) await new Promise((r) => setTimeout(r, 1500))
      return serveMediaNow(request)
    }
  : serveMediaNow

/**
 * The encoding and line endings each text file arrived with.
 *
 * Held here rather than threaded through the renderer because there are two
 * writers (the editor's own Ctrl+S and App's close-time "Save all changes")
 * and App's buffer map holds nothing but a path and a string. A path with no
 * entry - a file written before it was ever read - falls back to utf-8 with
 * LF, which is exactly what saving did before any of this existed.
 */
const textShape = new Map<string, TextShape>()

// Passwords that worked, for the read-only formats: 7-Zip needs one to LIST an
// encrypted rar or 7z, not just to extract, so a password the user typed once
// has to be remembered here as well as in the renderer.
const archivePasswords = new Map<string, string>()

/** Places inside archives (#300, archiveBrowse.ts). */
const archives = createArchiveBrowse({
  sevenExe: () => sevenExe(),
  password: (container) => archivePasswords.get(container) ?? '',
  remember: (container, password) => {
    archivePasswords.set(container, password)
  },
  temp: memberTemp
})

/** file:text's contract is a text file, not a log nobody can read: 64MB
 *  crosses the bridge as one string and lands in one CodeMirror doc. */
const TEXT_MAX_BYTES = 64 * 1024 * 1024

protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    // corsEnabled so an <audio crossorigin> element served over fsmedia:// is not
    // "tainted"; otherwise a MediaElementSource feeds the AnalyserNode silence and
    // the audio visualizer would sit dead. Paired with the ACAO header in serveMedia.
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  },
  {
    // The decoded-audio sidecar (audioSidecar.ts). Same privileges, same reason.
    scheme: AUDIO_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
])

/**
 * Build the open payload for a path: the folder's viewable siblings, the index
 * of the opened file (so the renderer can arrow through them), and the root.
 *
 * `root` is the tab's existing root, for a click inside a tree that must not
 * move. Omitted, the file's own folder becomes a root: that is what an open
 * from outside (launch argv, handoff, dialog, drag) does, and the renderer
 * decides from `root` whether that lands in an existing tab or a new one.
 */
async function buildPayload(p: string, root?: string): Promise<OpenPayload | null> {
  if (!(await exists(p))) return null
  const dir = dirname(p)
  const here = root ?? dir
  const files = (await listDir(dir)).files
  const idx = files.findIndex((v) => resolve(v.path) === resolve(p))
  // An opened file the tree wouldn't list (an unknown extension) still shows,
  // alone: you asked for this file, so you get it.
  if (idx < 0) return { files: [await toViewerFile(p)], index: 0, root: here }
  return { files, index: idx, root: here }
}

/** The profile every store lives in. Every Prism window is in this process
 *  (tab tear-off step 2, 2026-10-29): the Win+E windows that were second
 *  processes on profiles of their own, reading this one's, are gone. */
const preferencesOwner = userPaths.root()
const windowPreferences = createWindowPreferences(preferencesOwner, false)
/** The first restore of this process has happened ("Remember tabs" applies to it alone). */
let coldRestoreDone = false
const indexDirectory = join(preferencesOwner, 'search-index')
const sizeCacheDirectory = join(preferencesOwner, 'folder-sizes')
const indexer = initializeIndexerRuntime({
  binaryDirectory: app.isPackaged
    ? join(process.resourcesPath, 'everything')
    : join(__dirname, '..', '..', 'vendor', 'everything'),
  storageDirectory: indexDirectory,
  useExistingIndex: !process.argv.includes('--e2e') || process.env.PRISM_E2E_EXISTING_INDEX === '1',
  allowedRoot: process.argv.includes('--e2e') ? process.env.PRISM_E2E_INDEX_ROOT : undefined,
  allowService:
    app.isPackaged && !process.argv.includes('--e2e') && !process.argv.includes('--preview'),
  serviceInstance: indexerInstance(dirname(app.getPath('exe')))
})
async function warmIndexer(root?: string): Promise<void> {
  if (indexer.useExistingIndex && (await findRunningEverything(indexer.endpoint.exe))) return
  await indexer.ensureReady(root)
}
if (process.argv.includes('--e2e')) {
  ;(globalThis as typeof globalThis & { __prismIndexer?: typeof indexer }).__prismIndexer = indexer
}
const folderSizes = new FolderSizeCache({
  directory: sizeCacheDirectory,
  indexedSizes: getIndexedFolderSizes
})
/**
 * The Explorer's listings (#271): names first, details streamed, a cache on
 * disk for the first frame after a launch or a reboot, and a read ahead. The
 * index is read here, synchronously and before any window, because the
 * restore answers from it. One cache for every window of the process.
 */
const listingCache = createListingCache({
  directory: join(preferencesOwner, 'listing-cache'),
  allowed: isLocalFixed
})
listingCache.load()
/**
 * The Explorer's read of a place INSIDE an archive (#300): undefined when the
 * path is not inside one, so the ordinary folder read goes ahead. A folder that
 * has gone from the zip answers the nearest one still there, saying what was
 * missing; a damaged, locked or too-deep archive answers its reason.
 */
async function archiveRead(tabId: string, path: string, hops = 0): Promise<BrowseRead | null | undefined> {
  const r = await archives.resolve(path)
  if (!r) return undefined
  if (!r.ok) {
    if (r.reason === 'missing' && hops < 2) {
      const back = await archiveRead(tabId, placeOf(r.base, r.inner), hops + 1)
      if (back && !back.listing.unreadable)
        return {
          ...back,
          listing: {
            ...back.listing,
            archiveError: { reason: 'missing', container: r.container, message: archives.failText('missing') }
          }
        }
      return back
    }
    return {
      path: resolve(path),
      folderMtimeMs: 0,
      listing: {
        folders: [],
        files: [],
        unreadable: true,
        archiveError: { reason: r.reason, container: r.container, message: archives.failText(r.reason) }
      }
    }
  }
  // A path that ends on a FILE inside the zip is not a place to list.
  if (r.place.entry && !r.place.entry.dir) return null
  // As a folder read grants that folder: the archive verbs (`archiveOk`) ask
  // `insideDesktop` of the container, which its own folder's grant answers.
  grantDesktopDirectory(tabId, dirname(r.place.outer))
  return {
    path: placeOf(r.place.base, r.place.inner),
    listing: archives.listing(r.place, 'explorer'),
    folderMtimeMs: r.place.parsed.mtimeMs
  }
}
const explorerListings = createExplorerListings({
  cache: listingCache,
  // A tab's details to the window that owns the tab (2026-10-29).
  send: (tabId, channel, payload) => windows.sendToTabOwner(tabId, channel, payload),
  localFixed: isLocalFixed,
  archive: archiveRead,
  // E2E only: the slow-folder hint is proved by holding every names read, and
  // a details patch that lands after a select and a scroll by holding those.
  delayMs: process.argv.includes('--e2e') ? Number(process.env.PRISM_E2E_LIST_DELAY) || 0 : 0,
  detailsDelayMs: process.argv.includes('--e2e') ? Number(process.env.PRISM_E2E_DETAILS_DELAY) || 0 : 0
})
/** The tab strips across launches, one entry per window (tabsSession.ts). */
const { restoreTabs, session: sessionFile } = createTabsSession({
  cachedListing: (path) => explorerListings.cachedAsync(path),
  archiveRead: (tabId, path) => archiveRead(tabId, path),
  buildPayload: (p, root) => buildPayload(p, root)
})
// E2E only: a first run's home folder is a fixture, never the machine's own.
if (process.argv.includes('--e2e') && process.env.PRISM_E2E_HOME) app.setPath('home', process.env.PRISM_E2E_HOME)
/** Where a new window opened for a plain Win+E lands: "Folder for new tabs"
 *  when it names a folder, else the home Explorer the window opens on (a
 *  window cannot ask for a folder before it is there, so "Ask" is Home too). */
function newTabFolder(): string | null {
  const values = windowPreferences.load().values
  const folder = values['prism.newtab.folder']
  return values['prism.newtab.mode'] === 'folder' && folder ? folder : null
}
/**
 * WIN+E LANDS IN A WINDOW OF THIS PROCESS (tab tear-off step 2, 2026-10-29;
 * review finding #12). A cold start's request goes to the session's FIRST
 * window, as it always did: its pinned Explorer, or a new one. A request
 * while Prism runs opened a whole second Prism until now
 * (`explorerWindow.ts`, retired); it opens a NEW window here instead, whose
 * page answers it (`winEHostOf`): the folder it carries, else the folder for
 * new tabs.
 */
// The folder verb's folder (#393) travels with its request, and goes with it.
const winERequests = createWinERequests((id, host, browse) => {
  const to = windows.all().find((r) => winEHostOf(r) === host)
  const path = browse ?? (host === WIN_E_FIRST ? null : newTabFolder())
  windows.sendTo(to, PUSH.winEOpen, { id, path })
})
/** A Win+E or folder-verb request while Prism runs: a new window for it. */
function openWinEWindow(id: string): void {
  if (appState.appQuitting || appState.installingUpdate) return
  createWindow({ seed: { kind: 'none' }, winE: id })
}
/** Files from outside that wait for the window they go to (the one focused
 *  last, `windows.target()`) to restore. Only that window drains it: at the
 *  end of its restore, when it gains the focus having restored (the window
 *  they waited for may have lost it meanwhile, review 2026-10-29), and before
 *  a later handoff's files, so arrival order holds. */
let pendingOpen: Array<{ path: string; dir: boolean }> = []
/** Second-instance handoffs, read one after another so they keep arrival order. */
let handoffs: Promise<void> = Promise.resolve()
/** A tab id main makes (a restored tab without one, the home Explorer) is
 *  unique in the process: two windows can restore in the same millisecond. */
let mintSeq = 0
const mintTabId = (prefix: string): string => `${prefix}-${(mintSeq += 1)}-${Date.now()}`
/** The session file as it was at startup (2026-10-29): the first window is
 *  sized from it, and its restore reads its strip from it. */
let sessionRaw: string | null = null
/** Subtitle files the user chose in the dialog: reading those is allowed
 *  wherever they live, because choosing them in main's own dialog is the
 *  consent the root wall exists to ask for. */
const pickedSubs = new Set<string>()

async function sendOpen(target: { path: string; dir: boolean }, to: BrowserWindow | null): Promise<void> {
  // A FILE from outside goes to the Explorer tab (owner, 2026-09-22: "that file
  // opened in prism's explorer rather than as a project"). Nothing is built for
  // it: the Explorer grants its own folders per tab as it walks there. Same
  // channel as everything else, so it keeps its place behind the restore.
  if (!target.dir) {
    const explorerFile: OpenPayload = { explorerFile: target.path, files: [], index: -1, root: dirname(target.path) }
    windows.sendTo(to, PUSH.openFile, explorerFile)
    return
  }
  // A FOLDER opens an Explorer tab at it (owner, 2026-10-26: no more projects).
  // Nothing is built for it either; the page makes the tab and grants the folder.
  if (!(await exists(target.path))) return
  const explorerFolder: OpenPayload = { explorerFolder: target.path, files: [], index: -1, root: target.path }
  windows.sendTo(to, PUSH.openFile, explorerFolder)
}

/** One drain at a time: a focus, a restore's end and a handoff can each ask
 *  at once, and two loops shifting the queue could reorder the opens. */
let draining: Promise<void> = Promise.resolve()
/** The waiting files, to `win`, while it is still the window they go to. */
function drainPending(win: BrowserWindow, live: () => boolean = () => true): Promise<void> {
  const run = draining.then(async () => {
    while (pendingOpen.length && live() && !win.isDestroyed() && windows.target()?.win === win)
      await sendOpen(pendingOpen.shift()!, win)
  })
  draining = run.catch(() => {})
  return run
}

/** The phone switch, its port and the paired phones (#104). */

/**
 * A WEB LINK LEAVES THE APP HERE, AND NEVER UNDER --e2e (#222; owner,
 * 2026-09-24: "make sure that future runs don't do that in my real browser").
 * The terminal scenarios print and click https://example.com links, and every
 * run opened them as tabs in the owner's own browser. Under --e2e the link is
 * RECORDED on `globalThis.__e2eOpenedLinks` for the e2e to read, and nothing
 * outside the app is started.
 */
const e2eOpenedLinks: string[] = []
/** Folders Settings > Diagnostics asked Explorer to show, recorded the same
 *  way under --e2e (#322): a test run never opens an Explorer window. */
const e2eOpenedPaths: string[] = []
if (E2E) Object.assign(globalThis, { __e2eOpenedLinks: e2eOpenedLinks, __e2eOpenedPaths: e2eOpenedPaths })
function openLink(url: string): void {
  if (E2E) {
    e2eOpenedLinks.push(url)
    return
  }
  void shell.openExternal(url)
}

/**
 * Two things Windows needs told before the first window exists (2026-08-30).
 *
 * The AppUserModelID is how Windows decides that a running process and a
 * pinned shortcut are the SAME application. Told nothing, Electron invents one
 * from the executable path, the installed shortcut carries the one
 * electron-builder wrote from `appId`, and launching from the pin gave two
 * taskbar buttons for one Prism. It has to match the shortcut's, and it has to
 * be set before any window is created.
 *
 * The stock application menu is Electron's, not Prism's: an invisible menu bar
 * whose accelerators (Ctrl+R reload, Ctrl+Shift+I devtools, Ctrl+0 and
 * Ctrl+plus/minus zoom) were live over a frameless window that draws no menu
 * and hands those keys to the image viewer. Removing it costs nothing Prism
 * uses; the e2e keeps it, since the suite has no menu bar to be confused by
 * and devtools is worth having when a scenario fails.
 */
/**
 * A watched folder changed (2026-08-30): the Explorer follows the folder, not
 * just Prism's own writes. browseWatch.ts (one non-recursive watch per tab,
 * 2026-10-26) is the only caller; the recursive root watcher it replaced went
 * with the roots (2026-10-28).
 */
function folderChanged(change: { root: string; dirs: string[] }): void {
  // Our index and cache writes must not invalidate themselves recursively.
  const directories = change.dirs.filter((path) =>
    [indexDirectory, sizeCacheDirectory].every((privatePath) => {
      const rel = relative(privatePath, path)
      return rel !== '' && (rel.startsWith('..' + sep) || rel === '..' || isAbsolute(rel))
    })
  )
  // The page hears as soon as the sizes answer with the change, not once every
  // marker is on disk (2026-10-16); once either way, a failure included.
  let told = false
  const tell = (): void => {
    if (told) return
    told = true
    // To every window (2026-10-29): each page matches a change by path, so a
    // tab watching that folder hears it wherever it lives.
    windows.sendToAll(PUSH.dirChanged, change)
  }
  void folderSizes
    .invalidate(directories, tell)
    .catch(() => {})
    .finally(tell)
}

async function written(...paths: Array<string | null | undefined>): Promise<void> {
  // The wall's remembered resolutions (dirList `forgetCanonical`): a rename,
  // move or delete Prism made is never judged by where a path pointed before.
  forgetCanonical()
  await folderSizes
    .invalidate(paths.filter((p): p is string => typeof p === 'string' && !!p))
    .catch(() => {})
}

app.setAppUserModelId('com.prism.viewer')
if (!E2E) Menu.setApplicationMenu(null)
// The AES-zip path used to look for 7-Zip in Program Files and tell the user
// to install one, while Prism has been shipping it in resources/bin since
// 2026-08-24. Injected here so archive.ts stays electron-free and testable.
setSevenExe(sevenExe())
// Every adm-zip call that reads or rewrites a whole archive runs in this
// utility process, forked on first use (owner, 2026-10-12, zip work off the
// main process; zipWorker.ts).
setZipFork(() => utilityProcess.fork(join(__dirname, 'zipWorker.js'), [], { serviceName: 'Prism zip' }))
initDwmHelper(app.isPackaged, process.resourcesPath, app.getAppPath())
// Set once rather than on first use: the media wall consults it, and a wall
// whose rule appears part way through a session is a rule nobody can reason
// about.
wall.setComicsDir(userPaths.comics())

// All windows share the explicit shell-menu preference. Preview windows report
// the installed registration without automatically repointing it at a trial.
const shellVerbSetting = createShellVerbSetting({
  exe: app.getPath('exe'),
  marker: join(preferencesOwner, 'shell-verb-off'),
  automatic:
    app.isPackaged &&
    !E2E &&
    !process.argv.includes('--preview') &&
    !winERequest(process.argv)
})

/**
 * Keep the screen awake while something is playing (2026-08-30).
 *
 * A film is the one thing a computer does that involves no input for two
 * hours, so Windows dims and then locks the screen in the middle of it. The
 * renderer owns the truth (it knows whether a media element is actually
 * playing) and asks for the block; main holds at most one, and releases it the
 * moment nothing is playing or the window goes away. `prevent-display-sleep`
 * and not `prevent-app-suspension`: the point is the screen, and the weaker
 * block is implied by the stronger one anyway.
 */
let awakeId: number | null = null
/** The pages that are playing (2026-10-29): the block holds while ANY window
 *  plays, so one window pausing never lets the screen sleep under another's
 *  film. A window's close takes its own entry. */
const playing = new Set<number>()
function keepAwake(sender: { id: number }, on: boolean): void {
  if (on) playing.add(sender.id)
  else playing.delete(sender.id)
  holdAwake(playing.size > 0)
}
function holdAwake(on: boolean): void {
  if (on) {
    if (awakeId === null || !powerSaveBlocker.isStarted(awakeId)) {
      awakeId = powerSaveBlocker.start('prevent-display-sleep')
    }
    return
  }
  if (awakeId !== null && powerSaveBlocker.isStarted(awakeId)) powerSaveBlocker.stop(awakeId)
  awakeId = null
}

/**
 * THE PAGE COMES BACK, AND THE WINDOW IS NEVER LEFT UNSHOWN (#265; owner,
 * 2026-10-03: "prism suddenly stopped opening, not sure why, but that should
 * never happen"). The rules are in windowGuard.ts and crashBudget.ts; this is
 * their state for the process. One budget across rebuilt windows, so a window
 * that dies as fast as the one it replaced ends in a quit, not in a loop.
 */
const windowBudget = crashBudget()
/** THE DIAGNOSTICS LOG (#322), the core's (prism-term-core/main/diagnostics;
 *  schema in Prism Terminal's docs/diagnostics.md). Started once the
 *  single-instance lock is won; null in a launch that only hands its file over. */
let diag: Diagnostics | null = null
/** A watcher set-up this slow is said at the quiet level (#322). */
const SLOW_SETUP_MS = 50
/** A folder size scan this long is said at the quiet level (#322). */
const SLOW_SCAN_MS = 500
const crashLogFile = userPaths.windowCrashes
function logWindow(
  event: string,
  fields: Record<string, string | number | boolean | undefined>
): void {
  void appendCrashLog(crashLogFile(), crashLine(new Date(), event, fields))
  // AND IN THE DIAGNOSTICS LOG (#322): a hang or the watchdog belongs on the
  // same timeline as the stalls and crumbs before it, where `npm run diag`
  // reads it; what the core already writes is not written twice
  // (`diagWindow.ts`). window-crashes.log stays: the error box and the
  // `neverWindowless` e2e name that file.
  diagWindowEvent(event, fields)
}
app.on('before-quit', () => (appState.appQuitting = true))
/** E2E only: a dead page stays dead, as the bug left it, so the watchdog and
 *  the second launch can be proved as the nets they are. */
const holdRecovery = E2E && process.env.PRISM_E2E_HOLD_RECOVERY === '1'
let crashedAtStart = false
/**
 * Which page a startup restore belongs to (#265, review). A restore is a
 * sequence of awaits that drains the shared `pendingOpen` and ends by marking
 * its page restored; a page that dies part way through used to leave it
 * running into the page that replaced it, taking files a second launch had
 * just queued, sending tabs the new page restores itself, and marking a page
 * restored that had not even asked. Every main-frame load starts a new
 * generation of ITS window (`gen` in the window registry, 2026-10-29: one
 * window's load never cuts another's restore off), a window that has gone
 * ends its own, and a run from an older one stops at its next step and
 * touches nothing shared.
 */

/** A fresh window in place of one whose page keeps dying. The new one is
 *  built FIRST: destroying the only window first would read as the last
 *  window closing, and the app would quit. It comes back with THAT window's
 *  tabs, as its page last reported them (2026-10-29), never the saved strip
 *  of another: a second window that crashes must not come back as a copy of
 *  the first. */
function recreateWindow(old: BrowserWindow): void {
  const r = windows.recordOf(old)
  const seed: WindowSeed = r?.reported ? { kind: 'tabs', tabs: r.reported } : (r?.seed ?? { kind: 'none' })
  const bounds = old.isDestroyed() ? undefined : old.getNormalBounds()
  const fresh = createWindow({ first: r?.first, seed, launchFlags: r?.launchFlags, bounds, winE: r?.winE })
  if (r) {
    windows.handOver(old, fresh)
    sessionFile.rekey(r.id, fresh.webContents.id)
  }
  if (!old.isDestroyed()) old.destroy()
}

/** Nothing left to try: say so (never under --e2e) and end the process, which
 *  frees the single-instance lock for the next launch. An ordinary quit, not
 *  `app.exit`, so `will-quit` still stops the shells and the indexer; the
 *  windows go first, since a dead page has no close question to answer. */
function giveUpWindow(): void {
  if (!E2E)
    dialog.showErrorBox(
      'Prism',
      `Prism's window stopped working several times in a row, so Prism has closed. Open it again to carry on. Details are in ${crashLogFile()}.`
    )
  appState.appQuitting = true
  // The crash log is written off main now (2026-10-12): the last lines land
  // before the windows go, since the last window going quits the app.
  void crashLogSettled().finally(() => {
    for (const w of BrowserWindow.getAllWindows()) w.destroy()
    app.quit()
  })
}

/**
 * Make sure there is a window with a live page before a second launch's files
 * are handed over (#265). Answers true when it STARTED a page (a new window or
 * a reload), since the files then wait in `pendingOpen` for the page to listen.
 * Raising a window whose page is gone, which is all this used to do, shows a
 * blank frame at best. The window is the one files from outside go to (the
 * one focused last, 2026-10-29); with none left, a new one opens the strip of
 * the window closed last.
 */
function ensureLivePage(): boolean {
  if (!app.isReady() || !firstWindowMade) return false // whenReady makes the window and drains the queue
  if (appState.appQuitting || appState.installingUpdate) return false // a window now would only be taken away
  const target = windows.target()
  if (!target) {
    logWindow('handoff', { window: 'none', action: 'create' })
    const last = sessionFile.primary()
    // WITHOUT the saved ids (review, 2026-10-29): the last window's close
    // released them for good (releaseDesktop), so the same ids could never
    // be granted their folders again. The restore mints new ones.
    const tabs = last ? last.tabs.map((t) => ({ ...t, id: undefined })) : []
    createWindow({
      first: true,
      seed: tabs.length ? { kind: 'tabs', tabs: { tabs, active: last!.active } } : { kind: 'none' }
    })
    return true
  }
  if (pageGone(target.win)) {
    logWindow('handoff', { window: 'dead', action: 'reload' })
    target.restored = false
    target.win.webContents.reload()
    return true
  }
  return false
}

/**
 * THE NATIVE SWEEP BOX (#338; src/main/sweepOverlay.ts): started lazily, once,
 * after the first window has painted (#189: nothing on the startup path), and
 * every window after that gets its target the same way.
 */
let sweepOverlay: SweepOverlay | null = null
function sweepOverlayFor(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  if (!sweepOverlay) {
    sweepOverlay = initSweepOverlay({
      // sync-ok: once, after the first window has painted; loading a native addon is synchronous anyway
      load: () => loadSweepAddon(sweepDirs(app.isPackaged, process.resourcesPath, app.getAppPath()), existsSync),
      e2e: E2E,
      argv: process.argv,
      log: (fields) => mainCrumb('sweep-overlay', fields),
      ipc: ipcMain,
      windowOf: (sender) => BrowserWindow.fromWebContents(sender)
    })
    // Remote Desktop composes on the client: asked again when a session or
    // the displays change.
    const recheck = (): void => sweepOverlay?.recheck()
    screen.on('display-metrics-changed', recheck)
    screen.on('display-added', recheck)
    powerMonitor.on('unlock-screen', recheck)
    // The thread is joined at will-quit and again (idempotent) at the
    // process's exit, which `app.exit` reaches and will-quit does not.
    app.once('will-quit', () => sweepOverlay?.shutdown())
    process.once('exit', () => sweepOverlay?.shutdown())
  }
  sweepOverlay.attach(win)
}
/** After the first frame is on screen, not in the race for it. */
const SWEEP_OVERLAY_DELAY_MS = 400

/** How a window is made (2026-10-29: Prism has several in one process). */
interface WindowOptions {
  /** The session's first window, or its crash rebuild: the one a cold-start
   *  Win+E lands in, and the e2e's main window. */
  first?: boolean
  /** Where its tabs come from (windowRegistry.ts `WindowSeed`). Only the cold
   *  start's first window is made with `saved`. */
  seed?: WindowSeed
  /** `--prism-setup` / `--prism-demo`: the cold start's first window's only. */
  launchFlags?: readonly string[]
  /** Where it opens; the first window's come from the session file. */
  bounds?: { x?: number; y?: number; width: number; height: number }
  /** The saved entry of the session file, for the cold start's first window. */
  saved?: SessionEntry | null
  /** The Win+E or folder-verb request this window is opened for while Prism
   *  runs (step 2): its page answers it. */
  winE?: string | null
  /** The tear-off's spare (step 3): hidden until a tab is torn off into it. */
  spare?: boolean
}

/** The first window of the session has been made (whenReady). */
let firstWindowMade = false
/** Windows made so far: each window's key (`w1`, `w2`, ...), the prefix of
 *  the tab ids its page mints. */
let windowSerial = 0
/** `session-end` comes to every window; its last lines are written once. */
let sessionEnded = false

/** The renderer flags only the cold start's first window gets: setup runs the
 *  guide, the demo its own (they ride in the page's argv). A later window
 *  never inherits them from the process (2026-10-29). */
function coldStartFlags(): string[] {
  return [
    ...(process.argv.includes('--setup') ? ['--prism-setup'] : []),
    ...(process.argv.includes('--demo') ? ['--prism-demo'] : [])
  ]
}

/** Where a window that is not the first opens: the size of the one focused
 *  last, a step down and right of it, else Prism's first-run size. */
function nextWindowBounds(): { x?: number; y?: number; width: number; height: number } {
  const from = windows.target()?.win
  if (from && !from.isDestroyed()) {
    const b = from.getNormalBounds()
    return { x: b.x + 32, y: b.y + 32, width: b.width, height: b.height }
  }
  return firstWindow(screen.getPrimaryDisplay().workArea)
}

function createWindow(options: WindowOptions = {}): BrowserWindow {
  const first = !!options.first
  const launchFlags = [...(options.launchFlags ?? [])]
  const place = options.bounds ?? (options.saved !== undefined ? readWindowState(options.saved?.bounds ?? null) : nextWindowBounds())
  const key = `w${(windowSerial += 1)}`
  const win = new BrowserWindow({
    title: 'Prism',
    width: place.width,
    height: place.height,
    x: place.x,
    y: place.y,
    minWidth: 560,
    minHeight: 400,
    show: false,
    // Every window under --e2e, whoever made it (2026-10-29): offscreen and
    // unfocusable, never placed from a cursor or a saved size.
    ...(E2E ? { x: -4000, y: -4000, focusable: false, skipTaskbar: true } : {}),
    // Not `frame: false`: DWM refuses to composite acrylic or mica behind a
    // frameless window, which is why a translucent style came out as a hole in
    // the screen. 'hidden' drops the caption but keeps the frame DWM needs, and
    // the custom title bar still draws over it.
    titleBarStyle: 'hidden',
    // Explicit, rather than inherited from the executable: Windows caches the
    // exe's icon per path, so a new build can keep showing the old one in the
    // taskbar. A window icon set here is not cached by anything.
    icon: app.isPackaged
      ? join(process.resourcesPath, 'icon.ico')
      : join(__dirname, '../../build/icon.ico'),
    // The theme's own ground (step 3): the spare must never flash another.
    backgroundColor: themeGround(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      /* Never throttled (2026-08-27). Chromium takes a window nobody can see
       * down to about a frame a second, and with it goes the media: a film
       * paused the instant another window covered Prism. It was right for a
       * viewer sitting idle in the background and wrong for one that is
       * playing, and Prism cannot tell the difference cheaply enough to be
       * worth the surprise. (The recorder needed this too - a throttled
       * window films as a slideshow.) */
      backgroundThrottling: false,
      // Setup launches Prism with --setup so the guide runs even on a machine
      // that has seen it before. It rides in the renderer's own argv rather
      // than an IPC message, so it is there before the first render. The
      // first window's only (`coldStartFlags`).
      additionalArguments: [
        ...launchFlags,
        // The window's key: the prefix of every tab id its page mints, so
        // ids are unique across windows (2026-10-29, sessionIds.ts).
        `--prism-window=${key}`,
        // The page's clipboard is main's in-memory one under --e2e (#356);
        // the preload learns it here, since the renderer's argv is its own.
        ...(E2E ? ['--prism-e2e'] : [])
      ]
    }
  })
  const rec = windows.add(win, {
    key,
    first,
    seed: options.seed ?? { kind: 'none' },
    launchFlags,
    winE: options.winE,
    spare: options.spare
  })
  const page = rec.id
  /** The Win+E requests this window's page answers, if any (`winEHostOf`). */
  const winEHost = winEHostOf(rec)
  firstWindowMade = true
  // The cold start's first window carries the saved entry until its page
  // reports a strip of its own (session.ts `seed`).
  if (options.saved) sessionFile.seed(page, options.saved)
  // A Win+E window never outranks an ordinary one at the next cold start
  // (session.ts, review 2026-10-29); its crash rebuild keeps the rank.
  if (options.winE) sessionFile.minor(page)
  // A window that is not the first is parked the moment it exists under
  // --e2e, so nothing it shows can be seen (the harness parks every window).
  if (E2E && !first) win.setOpacity(0)
  // The diagnostics log's watch (#322): this window's hang events, and its
  // frame for the page's stack when ITS heartbeat stops (each page beats on
  // its own, 2026-10-29). A rebuilt window (#265) is handed over the same way.
  diag?.watchWindow(win)
  // Windows is shutting down or logging off: no will-quit is coming, so the
  // log's last lines (those just before a hang at shutdown) are written here,
  // once however many windows hear it.
  win.on('session-end', () => {
    if (sessionEnded) return
    sessionEnded = true
    diag?.log.write('main', 'session-end', {})
    diag?.log.flushSync() // sync-ok: shutdown, the process may be killed right after session-end
  })
  let shown = false
  const showWindow = (): void => {
    if (shown || win.isDestroyed()) return
    shown = true
    // Never reopened maximised (owner, 2026-10-11): see windowSize.ts.
    if (E2E) win.showInactive()
    else raise(win)
    // No helper to warm (#189): the border program is compiled at build time
    // and started per change with no pipe, so this costs milliseconds and the
    // first frame no longer waits ~900 ms behind a PowerShell's stdin pipe.
    applyDwmBorder(win)
  }
  // The spare stays hidden: the tear shows it, inactive, under the cursor.
  const showUnlessSpare = (): void => {
    if (!rec.spare) showWindow()
  }
  win.once('ready-to-show', showUnlessSpare)
  win.webContents.once('dom-ready', showUnlessSpare)
  // The first spare, a moment after the first window has painted (#189:
  // nothing on the startup path).
  if (first && !firstSpareAsked) {
    firstSpareAsked = true
    win.webContents.once('did-finish-load', () => spareSoon())
  }
  // The native sweep box's target (#338), once this window has painted.
  win.webContents.once('did-finish-load', () => setTimeout(() => sweepOverlayFor(win), SWEEP_OVERLAY_DELAY_MS))
  guardWindow(win, {
    budget: windowBudget,
    log: logWindow,
    show: showUnlessSpare,
    // A spare that keeps dying is simply made again later: it holds nothing.
    recreate: () => (rec.spare ? replaceSpare(win) : recreateWindow(win)),
    giveUp: giveUpWindow,
    // The text the page held died with it; a close must not ask about it.
    // THIS window's flag only (2026-10-29): another window's text is alive.
    stateLost: () => {
      rec.dirty = false
    },
    quitting: () => appState.appQuitting,
    held: () => holdRecovery
  })
  // E2E only: the page dies as it commits, before anything has shown the
  // window, which is the shape of the 2026-10-03 failure. Once per process.
  if (E2E && process.env.PRISM_E2E_CRASH_AT_START === '1' && !crashedAtStart) {
    crashedAtStart = true
    win.webContents.once('did-navigate', () => win.webContents.forcefullyCrashRenderer())
  }
  // The border follows maximize state; fullscreen changes call applyDwmBorder
  // themselves on the way out, and applyMaterial's debounce covers the rest.
  win.on('maximize', () => applyDwmBorder(win))
  win.on('unmaximize', () => applyDwmBorder(win))
  // Its bounds go into its own entry of the session file (session.ts).
  watchWindowState(
    win,
    (bounds) => sessionFile.bounds(page, bounds),
    // On main's thread only for the last window or the quit (the window
    // closing is still counted here).
    () => sessionFile.flush(windows.count() <= 1 || appState.appQuitting || appState.installingUpdate)
  )
  // Files from outside go to the window focused last.
  win.on('focus', () => {
    windows.focused(win)
    sessionFile.focus(page)
    // Files queued for a window still restoring when the focus moved here:
    // this one has restored, so they open here now (review, 2026-10-29).
    if (pendingOpen.length && rec.restored) void drainPending(win)
  })
  /**
   * A WINDOW'S CLOSE LETS GO OF WHAT ITS TABS HELD (2026-10-29). Closing a
   * window's last tab closes the window without a `browseRelease` per tab
   * (useTabOps.ts), which was fine while that close ended the process. With
   * other windows still open, every tab of the closed one would keep its
   * folder grants, its folder watch, its listing's details run and its
   * searches, and its tails and conversions would run on for nobody. So main
   * releases them here, except a tab that is moving to another window
   * (`windows.markMoving`, tab tear-off step 3), and except a window being
   * replaced by its own crash rebuild, whose tabs live on in the new one.
   */
  win.on('closed', () => {
    const rebuilding = rec.rebuilding
    const spare = rec.spare
    // A tear in flight from or into this window ends (its tab goes back).
    // FIRST, before the registry forgets the window (review 2026-10-29): the
    // tab stops flying here, so the source's own close below releases it
    // rather than leaving its grants and watch to nobody.
    tear.gone(win)
    const released = windows.remove(win)
    const others = windows.count() > 0
    if (spare) {
      // The spare holds nothing of the session: no entry, nothing to release.
      // Made again later, unless the app is going.
      if (others && !appState.appQuitting) spareSoon()
    } else if (!rebuilding) {
      // The session file: a window closed while others stay open takes its
      // entry with it; the last one keeps it (owner, 2026-10-29).
      // A shutdown or log-off is a quit too: Windows closes the windows one
      // by one with no before-quit, and each would otherwise drop its entry,
      // leaving only whichever closed last (review, 2026-10-29).
      sessionFile.closed(page, {
        others,
        quitting: appState.appQuitting || appState.installingUpdate || sessionEnded
      })
      for (const tabId of released) releaseTab(tabId)
      // Its Win+E state goes with it (a crash rebuild's window keeps it).
      if (winEHost) winERequests.forget(winEHost)
    }
    // Tails are keyed by the PAGE, not the tab: a crash rebuild's new page
    // has a new id and starts its own, so the old page's stop here too
    // (review, 2026-10-29), or each crash left a poller reading for nobody.
    stopTailsOf(tailOwner({ id: page }))
    if (playing.delete(page)) holdAwake(playing.size > 0)
    // THE SHROUD NEVER KEEPS THE APP ALIVE: the last page window gone, the
    // hidden fullscreen cover goes too, so `window-all-closed` can come. And
    // so does the tear-off's spare (step 3): a hidden window must never keep
    // Prism running with nothing on screen.
    if (!others) {
      releaseShroud()
      dropSpare()
    }
    // Files that were waiting for this window go to the one now in front,
    // once it has restored.
    else if (pendingOpen.length && windows.target()?.restored) void drainPending(windows.target()!.win)
  })
  /**
   * Minimised, and focused, told to the page (2026-08-26).
   *
   * The renderer cannot see either: Electron does not mark a MINIMISED window
   * hidden, so `visibilitychange` never fires and `document.hidden` stays
   * false, and window blur in the page is not the same question as "another
   * application has the focus". The player's "pause in the background" setting
   * needs both, so main - which does know - says so. THIS window's state, to
   * this window's page (2026-10-29).
   */
  const sayState = (): void => {
    if (win.isDestroyed()) return
    windows.sendTo(win, PUSH.windowState, {
      minimised: win.isMinimized(),
      focused: win.isFocused()
    })
  }
  // Listed one by one: BrowserWindow's overloads are per event name, so a loop
  // over a union of them has no single signature to match.
  win.on('minimize', sayState)
  win.on('restore', sayState)
  win.on('show', sayState)
  win.on('hide', sayState)
  win.on('focus', sayState)
  win.on('blur', sayState)

  win.on('enter-full-screen', () => {
    windows.sendTo(win, PUSH.windowFullscreen, true)
    applyMaterial(win, true)
  })
  win.on('leave-full-screen', () => {
    windows.sendTo(win, PUSH.windowFullscreen, false)
    applyMaterial(win, false)
  })
  /**
   * A window the page tried to open. Denied, and handed to the OS only when
   * it is a web address (2026-08-31).
   *
   * There was no scheme check here at all, which made any `<a target=_blank>`
   * or `window.open` in the renderer a one-click launch of an arbitrary URI
   * scheme on the user's machine. The renderer shows documents from anywhere
   * - a PDF, a markdown file, a zip member - so "the page asked for it" is
   * not a reason to trust it. Same test as the `shell:external` handler, and
   * for the same reason.
   */
  win.webContents.setWindowOpenHandler((d) => {
    if (/^https?:\/\//i.test(d.url)) openLink(d.url)
    return { action: 'deny' }
  })
  // A page cannot navigate the window away from the app either: the renderer
  // is Prism's own UI and nothing in it is a browser.
  win.webContents.on('will-navigate', (e, url) => {
    const dev = process.env['ELECTRON_RENDERER_URL']
    if (dev && url.startsWith(dev)) return
    if (url.startsWith('file://')) return
    e.preventDefault()
    if (/^https?:\/\//i.test(url)) openLink(url)
  })

  win.webContents.on('did-start-loading', () => {
    rec.restoreStarted = false
    rec.restored = false
    // Its strip comes back when the new page reports it.
    rec.strip = null
    // This window's Win+E requests wait for its new page (a cold start's
    // lands in the first window, one while Prism runs in its own).
    if (winEHost) winERequests.reload(winEHost)
  })
  // The page itself, not a frame inside it: a document preview's iframe
  // loading is no reason to abandon a restore.
  win.webContents.on('did-start-navigation', (details) => {
    if (!details.isMainFrame || details.isSameDocument) return
    rec.gen += 1
    // A source page reloading mid-tear can no longer end it (step 3): the
    // page itself only, a preview's iframe loading ends nothing.
    tear.lost(win)
  })
  // A shortcut press needs an immediate window even on a cold renderer load.
  // Its solid background is followed by the lightweight opening screen. The
  // first window's from the process's argv (a later window never reads it),
  // a window opened for a request while Prism runs from that request.
  if ((first && winERequest(process.argv)) || rec.winE) showWindow()
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))

  // Rebuild last session's strip, then deliver whatever the app was launched
  // with. Order matters: the launch file goes through the same arriving-file
  // rule as everything else, so double-clicking a photo in a folder that was
  // already open lands in that tab rather than opening a second copy of it.
  // The lightweight loading shell can finish its document before App loads.
  // Start restore only once the renderer is actually listening for its files.
  const restoreWhenListening = (event: Electron.IpcMainEvent): void => {
    // THIS window's page only (2026-10-29): every window has its own listener.
    if (event.sender.id !== page || win.isDestroyed()) return
    if (rec.restoreStarted) {
      if (rec.restored) event.sender.send(PUSH.openRestored)
      return
    }
    rec.restoreStarted = true
    // THE SPARE'S PAGE (step 3): nothing to restore, not even the home
    // Explorer, and no file from outside is ever drained into it. It is ready
    // as soon as it listens; a tab torn off is handed to it then. Asked of
    // `spare`, not of `reported`: a drop only commits (and reports) once this
    // page has drawn the tab (review 2026-10-29).
    if (rec.spare && rec.seed.kind === 'adopt') {
      rec.restored = true
      event.sender.send(PUSH.openRestored)
      tear.listening(win)
      return
    }
    const gen = rec.gen
    const stale = (): boolean => gen !== rec.gen || win.isDestroyed()
    // SEQUENTIAL, and that is the whole point of the IIFE (2026-08-31). These
    // became async when listDir did, and firing them off together would let
    // the launch file race the restored tabs: the arriving-file rule folds a
    // file into a tab whose root already holds it, so a launch file that
    // arrives BEFORE its own restored tab spawns a duplicate instead.
    void (async () => {
      // WHERE THIS PAGE'S TABS COME FROM (2026-10-29): the strip it reported
      // last (a reload, a crash), else what the window was made with. Only
      // the cold start's first window is made with the saved strip, so no
      // other window can ever restore a copy of it.
      const seed: WindowSeed = rec.reported ? { kind: 'tabs', tabs: rec.reported } : rec.seed
      // "Remember tabs" (owner, 2026-09-22), off: a COLD start opens only the
      // Explorer tab and what Prism was opened with. Once per process, so a
      // reload of the window in the same session still gets its tabs back; the
      // tabs are saved either way.
      const remember = windowPreferences.load().values['prism.tabs.remember'] !== 'off'
      const skip = seed.kind === 'saved' && !remember && !coldRestoreDone
      if (seed.kind === 'saved') coldRestoreDone = true
      // A page back from more than one death in a row comes back without its
      // saved tabs (#265, review): one of them may be what kills it, and
      // restoring it at every recovery ends in the give-up, then the same
      // give-up at every later launch. The Explorer tab and the files handed
      // over still arrive; the log says the tabs were left out.
      const strained = windowBudget.strained(Date.now())
      if (strained && seed.kind !== 'none' && !skip)
        logWindow('restore', { tabs: 'skipped', reason: 'repeated-deaths' })
      const send = (payload: OpenPayload): void => {
        if (!stale()) windows.sendTo(win, PUSH.openFile, payload)
      }
      // The strip, filtered (`parseTabs`: a root that has gone takes its tab).
      const strip = (): SavedTabs | null => {
        if (skip || strained) return null
        if (seed.kind === 'saved') return sessionRaw ? parseTabs(sessionRaw) : null
        if (seed.kind === 'tabs') return parseTabs(JSON.stringify(seed.tabs))
        return null
      }
      const saved = strip()
      // The home Explorer first when no pinned one was saved (#271): it is
      // the tab the window opens on, and a names-only read is 1 to 3 ms.
      const sendHome = async (): Promise<void> => {
        const id = mintTabId('explorer-home')
        const homePath = app.getPath('home')
        const home =
          (await explorerListings.cachedAsync(homePath)) ?? (await browseDirectory(id, homePath, 'names'))
        if (stale()) return
        if (home) {
          grantDesktopDirectory(id, home.path)
          send({
            root: home.path,
            files: home.listing.files,
            index: -1,
            role: 'explorer',
            pinned: true,
            restore: true,
            restoreTabId: id,
            listing: { path: home.path, listing: home.listing }
          } satisfies OpenPayload)
        }
      }
      const pinnedSaved = !!saved?.tabs.some((t) => t.role === 'explorer' && t.pinned)
      if (!pinnedSaved) await sendHome()
      if (stale()) return
      const pinnedSent = saved ? await restoreTabs(send, saved, (i) => mintTabId(`restored-${i}`)) : false
      if (stale()) return
      // A saved pinned Explorer whose folder has gone: the home one stands in.
      if (pinnedSaved && !pinnedSent) await sendHome()
      if (stale()) return
      // In argv order, each through the ordinary arriving-file route, so
      // several files from one folder still fold into ONE tab and the last
      // named ends up in front - the one a "prism a.jpg b.jpg" reader means.
      // New OS opens can arrive while a slow restore is still draining. Shift
      // the shared queue so those requests are preserved in arrival order too.
      // Only the window they go to drains it (the one focused last).
      await drainPending(win, () => !stale())
      if (stale()) return
      if (winEHost) winERequests.restored(winEHost)
    })()
      .catch((error: unknown) => console.error('Could not restore the startup session:', error))
      .finally(() => {
        if (stale()) return
        rec.restored = true
        // A handoff's paths are stat'ed awaited (2026-10-12), so one can land
        // in the queue just after the drain above ended: it opens now.
        if (pendingOpen.length) void drainPending(win, () => !stale())
        // A genuinely empty or failed restore may show the ordinary empty state.
        // Until this signal, no tabs means the initial folders are still loading.
        if (!event.sender.isDestroyed()) event.sender.send(PUSH.openRestored)
      })
  }
  ipcMain.on(CALL.openListen, restoreWhenListening)
  win.once('closed', () => ipcMain.removeListener(CALL.openListen, restoreWhenListening))
  return win
}

/** A window's page reported its strip: kept on its record (a crash rebuilds
 *  it from this) and in its own entry of the session file. */
function reportTabs(sender: Electron.WebContents, state: SavedTabs): void {
  const r = windows.of(sender)
  // The spare's strip is not the session's (step 3): the drop reports it.
  if (!r || r.win.isDestroyed() || r.spare) return
  r.reported = state && Array.isArray(state.tabs) ? state : { tabs: [], active: 0 }
  sessionFile.report(r.id, r.reported)
}

/**
 * TAB TEAR-OFF (step 3, owner, 2026-10-29; the gesture: src/main/tearOff.ts,
 * the numbers: src/shared/tabTear.ts). One hidden SPARE window is kept warm
 * (made ~2 s after startup and after each use) so a torn-off tab is in a real
 * window under the cursor within a frame or two. Under --e2e there is a spare
 * only when the scenario asks (`PRISM_E2E_SPARE=1`): a window appearing by
 * itself 2 s in would change what every other scenario counts.
 */
const spareWanted = (): boolean => !E2E || process.env.PRISM_E2E_SPARE === '1'
let spareTimer: NodeJS.Timeout | null = null
/** The first window has asked for the first spare. */
let firstSpareAsked = false
function spareSoon(delay: number = TEAR.spareDelayMs): void {
  if (!spareWanted() || spareTimer) return
  spareTimer = setTimeout(() => {
    spareTimer = null
    if (appState.appQuitting || appState.installingUpdate || windows.count() === 0) return
    const s = windows.spare()
    if (s && !tear.busy(s.win)) return
    createWindow({ spare: true, seed: { kind: 'adopt' } })
  }, delay)
}
/** The spare, made now if there is none ready to take (a tear cannot wait). */
function takeSpare(): BrowserWindow {
  const s = windows.spare()
  if (s && !tear.busy(s.win)) return s.win
  return createWindow({ spare: true, seed: { kind: 'adopt' } })
}
/** A spare whose page keeps dying: gone, and made again later. */
function replaceSpare(win: BrowserWindow): void {
  if (!win.isDestroyed()) win.destroy()
}
/** No window of the session is left: the spare goes too, so the app can end. */
function dropSpare(): void {
  if (spareTimer) clearTimeout(spareTimer)
  spareTimer = null
  for (const r of windows.all()) if (r.spare && !r.win.isDestroyed()) r.win.destroy()
}
const tear = createTearOff<BrowserWindow>({
  e2e: E2E,
  cursor: () => screen.getCursorScreenPoint(),
  workArea: (p) => screen.getDisplayNearestPoint(p).workArea,
  takeSpare,
  listening: (win) => !!windows.recordOf(win)?.restored,
  adopt: (win, carry) => void windows.sendTo(win, PUSH.tabAdopt, carry),
  moving: (tabId, on) => (on ? windows.markMoving(tabId) : windows.unmarkMoving(tabId)),
  // The drop: the floating window is a window of the session from now on,
  // with the tab it shows as its strip (its page reported it while it was
  // still the spare, which the session ignores).
  // The source's record and entry lose the tab at the same moment, not when
  // its page reports again (review 2026-10-29): until then its close released
  // the moved tab's grants and watch, and the file held the tab twice.
  commit: (win, carry, source) => {
    const r = windows.recordOf(win)
    if (!r) return
    r.spare = false
    const t = carry.tab
    r.reported = {
      // Its one tab is its home (`applyCarry`).
      tabs: [{ id: t.id, role: 'explorer', pinned: true, root: t.root, browse: t.browse, file: t.files[t.index]?.path }],
      active: 0
    }
    sessionFile.report(r.id, r.reported)
    const left = windows.handTab(t.id, source, win)
    const src = windows.recordOf(source)
    if (left && src) sessionFile.report(src.id, left)
  },
  reveal: (win) => {
    if (win.isDestroyed()) return
    if (E2E) win.showInactive()
    else raise(win)
    applyDwmBorder(win)
  },
  // The tab goes back: the floating page drops it, the window hides as the
  // spare, and whatever it reported or asked for is the source's again.
  release: (win, tabId, source) => {
    windows.sendTo(win, PUSH.tabRelease, tabId)
    if (!win.isDestroyed()) win.hide()
    const r = windows.recordOf(win)
    if (r) {
      r.reported = null
      r.dirty = false
      sessionFile.closed(r.id, { others: true, quitting: false })
    }
    // Its folder watch stops (review 2026-10-29): the floating page's own stop
    // comes after the tab is the source's again and is ignored, and the source
    // starts one only if it shows the tab (a background tab it never shows
    // kept a watch running for nobody).
    void browseWatch(tabId, null, () => {})
    if (source && !source.isDestroyed()) windows.noteTabOwner(tabId, source.webContents)
  },
  tell: (source, event) => void windows.sendTo(source, PUSH.tearEvent, event),
  spareSoon: () => spareSoon(),
  // STEP 4: ANY WINDOW'S STRIP TAKES THE TAB (owner, 2026-10-29). The
  // windows that can, front to back: shown, restored, not the spare; the one
  // focused most recently in front (main cannot read the system's z-order),
  // and among windows never focused (the e2e's) the newest, as a new window
  // opens on top.
  windowsFront: () =>
    windows
      .all()
      .filter((r) => !r.spare && r.restored && !r.win.isDestroyed() && r.win.isVisible() && !r.win.isMinimized())
      .reverse()
      .sort((a, b) => b.focusedAt - a.focusedAt)
      .map((r) => r.win),
  stripOf: (win) => windows.recordOf(win)?.strip ?? null,
  name: (win) => windows.recordOf(win)?.key ?? '',
  hover: (win, hover) => void windows.sendTo(win, PUSH.tabHover, hover),
  // The drop into another window's strip: that window has the tab from now on
  // (its record lists it at once, so its close releases it; its page reports
  // the real order next), and the source's record and entry lose it at the
  // same moment, exactly as a tear's commit does.
  merge: (target, carry, source, at) => {
    const r = windows.recordOf(target)
    if (!r) return
    const t = carry.tab
    const left = windows.handTab(t.id, source, target)
    const src = windows.recordOf(source)
    if (left && src) sessionFile.report(src.id, left)
    const tabs = (r.reported?.tabs ?? []).filter((x) => x.id !== t.id)
    const i = Math.max(0, Math.min(at ?? tabs.length, tabs.length))
    tabs.splice(i, 0, { id: t.id, role: 'explorer', root: t.root, browse: t.browse, file: t.files[t.index]?.path })
    r.reported = { tabs, active: i }
    sessionFile.report(r.id, r.reported)
    windows.sendTo(target, PUSH.tabMerge, { carry, at })
  },
  // To the front WITHOUT the focus: the source holds the pointer, and its
  // window losing the focus would cancel the carry.
  raise: (win) => {
    if (!win.isDestroyed()) win.moveTop()
  },
  hide: (win) => {
    if (!win.isDestroyed()) win.hide()
  },
  // The only tab's window holds the pointer's capture: it goes clear rather
  // than hidden, and never under --e2e (its windows are already clear, parked).
  fade: (win, out) => {
    if (!E2E && !win.isDestroyed()) win.setOpacity(out ? 0 : 1)
  },
  // Its tab went into another window: nothing is left in it, and its text went
  // with the tab, so it closes asking nothing. After this turn, so the page's
  // answer to its drop goes out first.
  closeEmptied: (win) => {
    const r = windows.recordOf(win)
    if (r) {
      r.closeConfirmed = true
      r.dirty = false
    }
    setTimeout(() => {
      if (!win.isDestroyed()) win.close()
    }, 0)
  },
  log: (event, fields) => mainCrumb(event, fields)
})
const isPoint = (p: unknown): p is Point =>
  !!p && Number.isFinite((p as Point).x) && Number.isFinite((p as Point).y)
/** The tear's IPC: from the source page (tear, end, the e2e's pointer) and
 *  from the floating one (it has drawn the tab). A spare never starts one. */
function registerTearIpc(): void {
  ipcMain.handle(CALL.tabTear, (e, req: unknown) => {
    const r = windows.of(e.sender)
    if (!r || r.spare || r.win.isDestroyed() || !validTearRequest(req)) return false
    return tear.start(r.win, req)
  })
  ipcMain.handle(CALL.tabTearEnd, (e, how: unknown) => {
    const r = windows.of(e.sender)
    if (!r || (how !== 'drop' && how !== 'cancel')) return { committed: false }
    return tear.end(r.win, how)
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

/**
 * What the IPC handlers in ipc/ reach that main holds (stage 9d of the
 * structure cleanup, 2026-10-12): index.ts's own state and helpers, handed to
 * every register function. A `let` that changes is never copied in here (the
 * handler would hold a stale value); it is read through a function instead.
 */
const ctx = {
  // The root wall (pathWall.ts) and its guards.
  wall,
  readable,
  editable,
  movable,
  archiveOk,
  archiveReadOk,
  comicOk,
  // Places inside archives, their passwords, and where members are unpacked.
  archives,
  archivePasswords,
  memberTemp,
  // The Explorer's listings and folder sizes, and the folder watch.
  explorerListings,
  listingCache,
  folderSizes,
  warmIndexer,
  folderChanged,
  SLOW_SETUP_MS,
  SLOW_SCAN_MS,
  // Prism's own writes: sizes refreshed.
  written,
  // Opening: the payload builders, a web link, picked subtitles.
  buildPayload,
  openLink,
  pickedSubs,
  // Text files: the size cap and the shape each arrived with.
  TEXT_MAX_BYTES,
  textShape,
  // The window, its preferences and the session.
  windowPreferences,
  preferencesOwner,
  winERequests,
  shellVerbSetting,
  reportTabs,
  keepAwake
}
export type MainCtx = typeof ctx

/** What only exists once the app is ready: made in whenReady and handed to
 *  the register functions that need it, beside `ctx`. */
export interface ReadyCtx {
  /** Where you had got to in each film (#118). */
  positions: Positions
  /** `file:text`'s body, shared with the phone's `/api/text`. */
  readTextWalled: (p: string) => Promise<TextRead>
  /** One ffprobe per file while it is unchanged, shared with the phone. */
  probeCached: (p: string) => Promise<MediaInfo | null>
  /** `doc:html`'s body, shared with the phone. */
  docHtmlOf: (p: string) => Promise<string | null>
}

// Single instance: a second launch (opening another file) forwards its path to
// the running window and focuses it, instead of spawning a rival process.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  /**
   * CRASH DUMPS STAY ON THIS MACHINE (#265). The windowless Prism of
   * 2026-10-03 left nothing to read: the crash reporter was never started, so
   * a renderer that died took its reason with it. Uploading is OFF: minidumps
   * go to userData's Crashpad folder and nowhere else. Started once the lock
   * is won, still before the app is ready, so a launch that only hands its
   * file over and exits (#189's fast path) never starts a crashpad_handler.
   */
  crashReporter.start({ uploadToServer: false })
  /**
   * THE DIAGNOSTICS LOG (#322; owner, 2026-10-07: "implement some robust
   * logging and debugging into the program especially to catch stalls for
   * example in explorer or in general"). Here and not at ready, for two
   * reasons: the crash hooks should hear a failure during startup too, and
   * every ipcMain registration comes after this line (the timing wraps
   * ipcMain itself, so a channel registered earlier would go untimed). Only
   * the instance holding the lock: a second launch hands its file over and
   * ends, and two writers on one file would interleave their batches. A
   * Win+E window is a window of this process (2026-10-29), so it logs here.
   */
  diag = startDiagnostics({
    diagLogDir: userPaths.logs(),
    ipcMain,
    process,
    app,
    appInfo: { name: 'Prism', version: pkg.version, e2e: E2E },
    openFolder: (dir) => {
      if (E2E) e2eOpenedPaths.push(dir)
      else void shell.openPath(dir)
    },
    longWaitChannels: [...LONG_WAIT_CHANNELS],
    powerMonitor: () => powerMonitor,
    // The `memory` crumb every five minutes and `mem-high` (perf review,
    // 2026-10-28): the core had them since 2026-10-16, but Prism never passed
    // the metrics, so three weeks of log had no reading while main sat at
    // 430 MB. Read only from the watch's timer, long after ready.
    appMetrics: () => app.getAppMetrics(),
    // Detailed logging until the owner switches it off (owner, 2026-10-27:
    // "keep logging as much as possible" while Prism is young). The e2e
    // keeps the quiet default its scenarios measure against.
    verboseByDefault: !E2E
  })
  // A main-lag of 1 s or more carries a CPU profile (2026-10-12) and a
  // Chromium trace (2026-10-27), in every session (owner, 2026-10-27, "keep
  // logging as much as possible"): the profile says what JavaScript did, the
  // trace what Electron and Chromium did when JavaScript sat idle
  // (lagProfiler.ts, nativeTrace.ts). Nothing is written without a lag.
  startLagProfiler({ log: diag.log, enabled: () => true })
  // contentTracing refuses to start before ready ("cannot be used before app
  // is ready", e2e diagLog), so the trace starts there; the profile above
  // covers the moments before it.
  const traceLog = diag.log
  // Quitting ends it: a dump started then would only be cut off, leaving its
  // .tmp behind (performance review, 2026-10-28).
  void app.whenReady().then(() => {
    const trace = startNativeTrace({ log: traceLog, tracing: contentTracing })
    app.once('before-quit', () => trace.stop())
  })
  // E2E only (review of #322): the harness ends a scenario with `app.exit`,
  // which skips will-quit, so it writes main's queue first and the run's
  // Stalls table sees a scenario's last moments.
  // sync-ok: e2e only, the harness calls it just before app.exit
  if (E2E) Object.assign(globalThis, { __e2eDiagFlush: () => diag?.log.flushSync() })
  app.on('second-instance', (_e, argv) => {
    const shortcutRequest = winERequest(argv)
    if (shortcutRequest) {
      // A window now would only be taken away: no answer, and the helper's
      // own File Explorer fallback opens instead.
      if (appState.installingUpdate || appState.appQuitting) return
      const browse = browseRequest(argv)
      // THE STARTING PROCESS'S FIRST WINDOW takes a request that arrives
      // before it is made, exactly as the cold start's own (the helper of a
      // second press while Prism is still starting).
      if (!firstWindowMade) {
        winERequests.enqueue(shortcutRequest, WIN_E_FIRST, browse)
        return
      }
      // A NEW WINDOW OF THIS PROCESS (tab tear-off step 2, 2026-10-29; it
      // was a whole second Prism). "started" goes down the helper's pipe at
      // once, and the id once that window's page shows the folder. A token
      // already pending (a retransmission) opens nothing more.
      if (winERequests.enqueue(shortcutRequest, shortcutRequest, browse)) openWinEWindow(shortcutRequest)
      return
    }
    // `Prism.exe --preview-update` while Prism is already running (it is
    // resident, so it usually is) ends here, not at the launch branch. Only
    // when nothing is on offer: a preview never replaces a real update, nor one
    // that is part way through its install.
    if (wantsPreview(argv) && !updateOffered()) offerUpdate(previewUpdate(pkg.version))
    // A launch that lands while this process is on its way out (#265, review)
    // must not make a window the quit or the installer then takes away with
    // its file. An install starts the new Prism itself; an ordinary quit
    // starts a fresh one with what was handed over, once this one has gone.
    if (appState.installingUpdate) return
    if (appState.appQuitting) {
      // sync-ok: quit, the relaunch must be decided before this process exits
      if (pathsFromArgv(argv).length && !E2E) app.relaunch({ execPath: argv[0], args: argv.slice(1) })
      return
    }
    // A new page restores and drains `pendingOpen` itself once it listens
    // (a reload or a new window starts unrestored).
    ensureLivePage()
    // The handoff is the case the foreground lock bites hardest: Prism has
    // been sitting in the background for an hour, and the file it is handed
    // must arrive in a window that is actually in front of you. Raised FIRST,
    // before the paths are even read, so the foreground-lock fix runs the
    // instant the handoff arrives. The window focused last (2026-10-29).
    const front = windows.target()?.win
    if (front) {
      if (E2E) front.show()
      else raise(front)
    }
    // The paths are stat'ed awaited (owner, 2026-10-12: main never waits on
    // the disk), one handoff after another so they keep arrival order. The
    // opens are sequential for the same reason as the launch drain above:
    // order is what folds them into one tab and leaves the last-named file in
    // front.
    handoffs = handoffs
      .then(async () => {
        const paths = await pathsFromArgvAsync(argv)
        if (appState.installingUpdate) return
        if (appState.appQuitting) {
          if (paths.length && !E2E) app.relaunch({ execPath: argv[0], args: argv.slice(1) })
          return
        }
        const to = windows.target()
        if (!to?.restored) pendingOpen.push(...paths)
        else {
          // Anything still queued goes first, so arrival order holds.
          await drainPending(to.win).catch(() => {})
          // Awaited INSIDE the chain (2026-10-16): fired and forgotten, a
          // later handoff's opens could overtake this one's, and the wrong tab
          // ended up in front. One path that fails still lets the rest open.
          for (const p of paths) await sendOpen(p, to.win).catch(() => {})
        }
      })
      .catch(() => {
        /* a handoff that cannot be read opens nothing */
      })
  })

  pendingOpen = pathsFromArgv(process.argv) // sync-ok: startup, before the first window
  const shortcutRequest = winERequest(process.argv)
  const browse = browseRequest(process.argv)
  if (shortcutRequest) winERequests.enqueue(shortcutRequest, WIN_E_FIRST, browse)

  let indexerStopped = false
  let stoppingIndexer = false
  app.on('will-quit', (event) => {
    if (!indexerStopped) {
      event.preventDefault()
      if (!stoppingIndexer) {
        stoppingIndexer = true
        // The crash log is written off main (2026-10-12): its last lines land first.
        void Promise.all([indexer.dispose(), crashLogSettled()]).finally(() => {
          indexerStopped = true
          app.quit()
        })
      }
      return
    }
    killSidecars()
    cancelAllConversions()
    // The quit is going ahead: the log's queue is written synchronously, so
    // its last lines land. LAST (review of #322): the shell, sidecar and
    // conversion teardown above is where a quit goes wrong (PT #127), and a
    // stopped log would hear nothing of it.
    diag?.stop()
    diag = null
  })

  app.whenReady().then(() => {
    // THE PAGE OPTS IN TO HAVING ITS STACK READ (#322): the diagnostics log
    // asks for it when the page's heartbeat stops (`collectJavaScriptCallStack`),
    // and the frame only answers for a document served with this
    // Document-Policy. MEASURED in Prism Terminal on Electron 43: without the
    // header the answer is "Website owner has not opted in"; with it the stack
    // of a 3 s busy loop came back in about 1 ms, file:// and dev server alike.
    // The window's own document only (never a preview's frame). The filter
    // keeps every other response off main's thread entirely (review of #322):
    // a folder of thumbnails or a seeking video must not queue behind the
    // thread whose lag the log measures. Before the window exists, so its
    // first load carries it.
    session.defaultSession.webRequest.onHeadersReceived({ urls: ['<all_urls>'], types: ['mainFrame'] }, (d, callback) => {
      if (d.resourceType !== 'mainFrame') return callback({})
      callback({ responseHeaders: withStackPolicy(d.responseHeaders) })
    })
    // E2E only (review of #271): the never-loading probe runs as a frame
    // preload, so it sees the page from before its first script. The harness
    // attaches only once the window exists, too late for that.
    if (E2E && process.env.PRISM_E2E_EARLY_PROBE)
      session.defaultSession.registerPreloadScript({
        type: 'frame',
        id: 'e2e-early-probe',
        filePath: process.env.PRISM_E2E_EARLY_PROBE
      })
    // Reuse a ready index before starting private background indexing. NOT
    // before the Explorer's first answer (#271): the indexer, the drive-kind
    // probe and folder sizes all want libuv's four threads, and they must not
    // queue in front of the listing the first frame is waiting for. The first
    // answer, or 1.5 s, whichever comes first.
    void explorerListings.settled.then(() => {
      void warmIndexer()
      void learnDriveKinds()
    })
    // Remember folders (#271): off deletes what was kept, at once.
    const rememberFolders = (values: Record<string, string>): void =>
      listingCache.setEnabled(values[REMEMBER_FOLDERS_KEY] !== 'off')
    rememberFolders(windowPreferences.load().values)
    // The common places are the last to be evicted (#271), with Quick access
    // (pinned as the page reads them ahead).
    for (const key of ['home', 'desktop', 'documents', 'downloads', 'pictures', 'music', 'videos'] as const) {
      try {
        listingCache.pin([app.getPath(key)])
      } catch {
        /* a profile without that folder */
      }
    }
    const stopPreferencesWatch = windowPreferences.watch((snapshot) => {
      rememberFolders(snapshot.values)
      // Every window's page (2026-10-29): one store, every window shows it.
      windows.sendToAll(PUSH.windowPreferencesChanged, snapshot)
    })
    app.once('will-quit', stopPreferencesWatch)
    app.once('will-quit', () => listingCache.flush())
    // Preferences are written off main while the app runs (2026-10-12): what is
    // still waiting goes down synchronously here, or a value set just before
    // quit is lost.
    app.once('will-quit', () => windowPreferences.flush())
    // The member temp folder (#300): this run's at quit, every dead run's once
    // the first answer is in (never on the startup path, #189).
    // On the process's own exit, which `app.exit` reaches and will-quit does not.
    process.once('exit', () => memberTemp.removeRun())
    void explorerListings.settled.then(() =>
      setTimeout(() => void cleanDeadRuns(memberTemp.root, pidAlive, memberTemp.dir), 5000)
    )
    // The profiles the retired Win+E processes kept (step 2, 2026-10-29), the
    // same way: never on the startup path, and nothing to do once gone.
    void explorerListings.settled.then(() =>
      setTimeout(() => void removeOldExplorerWindows(preferencesOwner), 5000)
    )
    registerPreferencesIpc(ctx)
    registerWinEIpc(ctx)
    protocol.handle(MEDIA_SCHEME, (request) => serveMedia(request))
    protocol.handle(AUDIO_SCHEME, (request) =>
      serveSidecarAudio(request, {
        allowed: readable,
        warm: warmWall,
        packaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        appPath: app.getAppPath()
      })
    )

    // One probe per file, kept for as long as the file has not changed: the
    // audio player, the video player, the no-picture note and the phone's
    // /api/play all ask. Null is "ffprobe could not read it" AND "there is
    // no ffprobe": the callers that tell those apart ask findFfmpeg first.
    // The in-flight probe is shared too (review, 2026-10-16): see probeCache.ts.
    const probeShared = createProbeCache(
      (p) => {
        const ffprobe = ffmpegTools()?.ffprobe
        return ffprobe ? probeMedia(ffprobe, p) : Promise.resolve(null)
      },
      async (p) => (await stat(p)).mtimeMs
    )
    const probeCached = async (p: string): Promise<MediaInfo | null> =>
      ffmpegTools()?.ffprobe ? probeShared(p) : null

    // The phone's HLS jobs (#105): one ffmpeg per phone and file, under
    // userData. Made once, and the directory is wiped at startup: segments
    // of a previous run belong to jobs nothing remembers.
    const HLS_DIR = userPaths.hls()
    // The phone diagnostics log (2026-09-12): one timeline for the server's
    // asks and restarts and the phone player's own stalls, beside the jobs.
    const phoneLog = new PhoneLog(userPaths.phoneLog())
    // Where you had got to in each film (#118): one store, by file path,
    // that the window reaches over IPC and the phone over /api/pos.
    const positions = new Positions(userPaths.positions())
    registerPositionsIpc(positions)
    const logPhone = (line: string): void => phoneLog.line(line)
    const hlsTools = ffmpegTools()
    // The phone grid's pictures (#135), made once and cached under userData.
    // Its ffmpegs register with the holders (#133), so a move of the file wins.
    const thumbs = hlsTools
      ? new Thumbs(hlsTools.ffmpeg, userPaths.thumbs(), (c, f) =>
          holders.add(c, f)
        )
      : null
    const hlsJobs = hlsTools
      ? new HlsJobs({ ffmpeg: hlsTools.ffmpeg, baseDir: HLS_DIR, log: logPhone })
      : null
    void rm(HLS_DIR, { recursive: true, force: true }).catch(() => undefined)

    /**
     * `file:text`'s body, factored (#106) so the phone's `/api/text` reads
     * the same way: capped, decoded by its own byte-order mark, the shape
     * remembered for a save. The WALL is not in here: the IPC handler checks
     * the root set and the extracted grants, the phone route checks its own
     * phone's root, and each grants what the answer names on its own side.
     */
    const readTextWalled = async (p: string): Promise<TextRead> => {
      try {
        const fs = await import('fs/promises')
        // AWAITED, so a read error is caught here rather than escaping as a
        // rejected invoke; and capped, because the contract is small text
        // files and CodeMirror is handed one string (2026-08-28).
        const st = await fs.stat(p)
        // Too big to hand over as one string. Answered as a REASON rather than
        // as null: the editor used to seed itself with a placeholder and could
        // then save that placeholder over the file (2026-08-28).
        if (st.size > TEXT_MAX_BYTES) return { error: 'too-large' }
        // Decoded by its own byte-order mark rather than assumed utf-8: a
        // .reg is UTF-16LE by definition and Prism claims .reg, and so is
        // anything PowerShell 5.1 redirected to a file. Those used to open as
        // mojibake, which Prism would then offer to save back over them. The
        // file's SHAPE is remembered so the save can reproduce it, line
        // endings included (see textFile.ts).
        const buf = await fs.readFile(p)
        const { text, encoding, eol } = shapeOf(buf)
        textShape.set(p.toLowerCase(), { encoding, eol })
        return { text }
      } catch {
        return { error: 'unreadable' }
      }
    }
    /** `doc:html`'s body, factored the same way (#106): converted AND
     *  sanitised on the document worker, null for anything that is not a document or
     *  would not convert. No wall in here either. */
    const docClient = createDocClient()
    const docHtmlOf = async (p: string): Promise<string | null> => {
      if (!docKind(extname(p))) return null
      try {
        // On the document worker, never main (2026-10-12, docClient.ts).
        return await docClient.html(p)
      } catch {
        return null
      }
    }

    // The archive bodies the phone shares, from `registerArchiveIpc` below.
    let archiveBodies: ArchiveBodies | null = null
    const phoneDeps = (hooks: PhoneHooks): PhoneServerDeps => ({
      rendererDir: RENDERER_DIR,
      devUrl: !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined,
      media: serveMedia,
      listDir,
      // The very function `search:files` answers the sidebar with, so the
      // phone's field and the PC's box find the same files by the same rules,
      // over the folder the phone is in (2026-10-14).
      search: (dir: string, query: string) => searchFiles(dir, query),
      // The desktop Explorer's rule, one owner per phone (phoneAccess.ts).
      access: { listed: phoneListed, may: phoneMay, release: phoneRelease, local: (p) => phoneOnThisPc(p) },
      places: () =>
        phonePlaces(
          () => browseLocations((key) => app.getPath(key)),
          hooks.pins(),
          async (paths) =>
            E2E ? withUsedShare(await driveUsage(paths), process.env.PRISM_E2E_DRIVE_USED) : driveUsage(paths)
        ),
      subsFor: async (p: string) => (await sidecarsFor(p)).map((t) => ({ path: t.path, label: t.label })),
      readSubs: (p: string) =>
        readAsVtt(p, ffmpegTools()?.ffmpeg),
      probe: probeCached,
      jobs: hlsJobs,
      readText: readTextWalled,
      docHtml: docHtmlOf,
      docImages: documentImages,
      isMarkdown,
      // `/m/` passes through serveMedia, whose wall is `mediaAllowed`; the
      // phone's grant on its side is not enough on its own.
      grantServable: (paths) => {
        for (const img of paths) wall.grantServable(img)
      },
      // The comic and archive bodies are made further down this block, by
      // `registerArchiveIpc` beside the gates they share. That is fine:
      // `phoneDeps()` is only ever called from `startPhone`, which runs after
      // the block has finished, so nothing here is read before it exists.
      comicOpen: (p, password) => archiveBodies!.openComicWalled(p, password),
      archiveList: (p, password) => archiveBodies!.listArchiveWalled(p, password),
      archiveExtract: (p, entry, password) => archiveBodies!.extractMemberWalled(p, entry, password),
      // The IPC's own kind gates, minus their root half (the route walls
      // with the phone's root instead): a .txt is never handed to 7-Zip.
      isArchive: (p) => fileKind(extname(p)) === 'archive',
      isComic: (p) => fileKind(extname(p)) === 'comic',
      onChange: hooks.onChange,
      log: logPhone,
      positions: {
        get: (p) => positions.get(p),
        set: (p, t) => positions.set(p, t)
      },
      thumb: (p) => {
        const kind = fileKind(extname(p))
        if (!thumbs || (kind !== 'image' && kind !== 'video')) return Promise.resolve(null)
        return thumbs.get(p, kind)
      },
      // A throwaway e2e build must never raise the firewall prompt.
      loopbackOnly: E2E
    })
    startPhoneService({ deps: phoneDeps, hlsJobs })

    /** What the IPC handlers in ipc/ need that only exists now (`ReadyCtx`). */
    const ready: ReadyCtx = { positions, readTextWalled, probeCached, docHtmlOf }

    startUpdates()
    registerOpenIpc()
    registerSaveCopyIpc(ctx)
    registerLinkIpc(ctx)
    installPermissionHandler()
    registerBrowseIpc(ctx)
    registerSessionIpc(ctx)
    registerTreeIpc(ctx)
    registerFilesIpc(ctx, ready)
    registerPropsIpc(ctx)
    registerMediaIpc(ctx, ready)
    registerShellIpc(ctx)
    registerMoveIpc(ctx, ready)
    archiveBodies = registerArchiveIpc(ctx)
    registerNewFilesIpc(ctx)

    registerWindowIpc()
    registerTearIpc()

    // THE SESSION'S FIRST WINDOW, and the only one that reads the saved strip
    // (2026-10-29): the session file is read once, here, before it exists, so
    // it opens at its saved size; its restore filters the strip from the same
    // text when its page listens.
    sessionRaw = readSessionRaw(userPaths.tabs()) // sync-ok: startup, before the first window (inside readSessionRaw)
    createWindow({ first: true, seed: { kind: 'saved' }, launchFlags: coldStartFlags(), saved: savedEntry(sessionRaw) })
    void shellVerbSetting.status()
    app.on('activate', () => {
      if (windows.count() === 0) ensureLivePage()
    })
    // E2E only (tab tear-off step 1, 2026-10-29): the scenarios open a second
    // window the way main makes any later one, find the session's FIRST
    // window whatever order Electron lists them in (`getAllWindows()[0]` is
    // no promise), and read what main still holds for a tab after its
    // window has closed.
    if (E2E)
      Object.assign(globalThis, {
        __e2eOpenWindow: (): number => createWindow({ seed: { kind: 'none' } }).id,
        __e2eMainWindow: (): BrowserWindow | null => (windows.all().find((r) => r.first) ?? windows.oldest())?.win ?? null,
        // The session's windows: the tear-off's spare is not one (`__e2eTear`).
        __e2eWindows: () =>
          windows.all().filter((r) => !r.spare).map((r) => ({
            id: r.win.id,
            page: r.id,
            key: r.key,
            first: r.first,
            winE: r.winE,
            dirty: r.dirty,
            restored: r.restored,
            tabs: (r.reported?.tabs ?? []).map((t) => t.id ?? '')
          })),
        __e2eTabHeld: (tabId: string) => ({ released: desktopClosed(tabId), watching: !!browseWatcherOf(tabId) }),
        // The tear-off (step 3): its phase, where the moving window WOULD be
        // (nothing moves under --e2e), its counts, and the spare.
        __e2eTear: () => {
          const s = windows.spare()
          return { ...tear.state(), spare: s ? { page: s.id, key: s.key, ready: s.restored } : null }
        },
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
  })

  app.on('window-all-closed', () => {
    // Nothing can be playing without a window, and a block that outlives the
    // thing it was held for is a laptop that never sleeps again.
    playing.clear()
    holdAwake(false)
    stopAllTails()
    if (process.platform !== 'darwin') app.quit()
  })
}
