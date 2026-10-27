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
import { browseRequest, createWinERequests, winERequest } from './winERequests'
import {
  cleanExplorerWindows,
  explorerWindowOwner,
  launchExplorerWindow,
  markExplorerWindow
} from './explorerWindow'
import { createWindowPreferences } from './windowPreferences'
import { isSkipped, listDir, searchFiles, toViewerFile } from './dirList'
import { isAnyRoot, onRootsChanged } from './roots'
import {
  grantDesktopDirectory,
  insideDesktop
} from './desktopAccess'
import { browseDirectory, browseLocations, type BrowseRead } from './browse'
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
import { closeAllWatches, muteDir, unwatchRoot, watchRoot } from './dirWatch'
import { readTabs } from './tabs'
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
import { stopAllTails } from './fileTail'
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
import { E2E, appState, sendToPage, isMainSender } from './appState'
import { createPathWall } from './pathWall'
import { MEDIA_SCHEME, createMediaServer } from './mediaProtocol'
import { heicToJpeg } from './heicClient'
import { ffmpegTools, sevenExe } from './bundledTools'
import { registerArchiveIpc, type ArchiveBodies } from './ipc/archive'
import { registerMediaIpc } from './ipc/media'
import { registerPropsIpc } from './ipc/props'
import { registerBrowseIpc, registerTreeIpc } from './ipc/browse'
import { registerLinkIpc } from './ipc/links'
import { installPermissionHandler } from './permissions'
import { registerSaveCopyIpc, registerFilesIpc, registerShellIpc, registerMoveIpc, registerNewFilesIpc } from './ipc/files'
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
  watchWindowState
} from './windowChrome'

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
  isAnyRoot,
  memberOwns: (p) => memberTemp.owns(p),
  rendererDir: RENDERER_DIR
})
const { readable, editable, movable, archiveOk, archiveReadOk, comicOk } = wall

/** fsmedia:// (mediaProtocol.ts), walled by `mediaAllowed`. */
const serveMedia = createMediaServer({ allowed: wall.mediaAllowed, ffmpeg: ffmpegTools, heic: heicToJpeg })

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

const extraWindowOwner = explorerWindowOwner(userPaths.root(), process.argv)
const preferencesOwner = extraWindowOwner ?? userPaths.root()
const windowPreferences = createWindowPreferences(preferencesOwner, !!extraWindowOwner)
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
 * restore answers from it. A second Explorer window reads it and never writes.
 */
const listingCache = createListingCache({
  directory: join(preferencesOwner, 'listing-cache'),
  allowed: isLocalFixed,
  readOnly: !!extraWindowOwner
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
  send: (channel, payload) => {
    if (appState.mainWindow && !appState.mainWindow.isDestroyed()) appState.mainWindow.webContents.send(channel, payload)
  },
  localFixed: isLocalFixed,
  archive: archiveRead,
  // E2E only: the slow-folder hint is proved by holding every names read, and
  // a details patch that lands after a select and a scroll by holding those.
  delayMs: process.argv.includes('--e2e') ? Number(process.env.PRISM_E2E_LIST_DELAY) || 0 : 0,
  detailsDelayMs: process.argv.includes('--e2e') ? Number(process.env.PRISM_E2E_DETAILS_DELAY) || 0 : 0
})
/** The tab strip across launches (tabsSession.ts). */
const { restoreTabs, saveTabs, flushTabs } = createTabsSession({
  cachedListing: (path) => explorerListings.cachedAsync(path),
  archiveRead: (tabId, path) => archiveRead(tabId, path),
  buildPayload: (p, root) => buildPayload(p, root)
})
// E2E only: a first run's home folder is a fixture, never the machine's own.
if (process.argv.includes('--e2e') && process.env.PRISM_E2E_HOME) app.setPath('home', process.env.PRISM_E2E_HOME)
let preferencesLoaded!: () => void
const preferencesReady = new Promise<void>((resolve) => {
  preferencesLoaded = resolve
})
/** The folder each Win+E request opens, when it came from the folder verb (#393). */
const winEBrowse = new Map<string, string>()
const winERequests = createWinERequests((id) =>
  sendToPage(PUSH.winEOpen, { id, path: winEBrowse.get(id) ?? null })
)
let pendingOpen: Array<{ path: string; dir: boolean }> = []
/** Second-instance handoffs, read one after another so they keep arrival order. */
let handoffs: Promise<void> = Promise.resolve()
let startupRestored = false
/** Subtitle files the user chose in the dialog: reading those is allowed
 *  wherever they live, because choosing them in main's own dialog is the
 *  consent the root wall exists to ask for. */
const pickedSubs = new Set<string>()

async function sendOpen(target: { path: string; dir: boolean }): Promise<void> {
  // A FILE from outside goes to the Explorer tab (owner, 2026-09-22: "that file
  // opened in prism's explorer rather than as a project"). Nothing is built for
  // it: the Explorer grants its own folders per tab as it walks there. Same
  // channel as everything else, so it keeps its place behind the restore.
  if (!target.dir) {
    const explorerFile: OpenPayload = { explorerFile: target.path, files: [], index: -1, root: dirname(target.path) }
    sendToPage(PUSH.openFile, explorerFile)
    return
  }
  // A FOLDER opens an Explorer tab at it (owner, 2026-10-26: no more projects).
  // Nothing is built for it either; the page makes the tab and grants the folder.
  if (!(await exists(target.path))) return
  const explorerFolder: OpenPayload = { explorerFolder: target.path, files: [], index: -1, root: target.path }
  sendToPage(PUSH.openFile, explorerFolder)
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
 * The tree follows the folder, not just Prism's own writes (2026-08-30).
 *
 * The watcher set is the ROOT set by construction: roots.ts announces every
 * open and close and this is the only thing that starts or stops a watch, so
 * it can never drift onto a path the renderer named.
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
    if (appState.mainWindow && !appState.mainWindow.isDestroyed())
      appState.mainWindow.webContents.send(PUSH.dirChanged, change)
  }
  void folderSizes
    .invalidate(directories, tell)
    .catch(() => {})
    .finally(tell)
}

onRootsChanged((root, open) => {
  if (!open) {
    unwatchRoot(root)
    return
  }
  watchRoot(root, folderChanged, isSkipped)
})

/**
 * Prism is about to write here itself, so the watcher should say nothing.
 *
 * Every one of these handlers is already followed by the renderer refreshing
 * that folder; a watcher echo would be a second, redundant refresh that also
 * costs the selection twice.
 */
function ownWrite(...paths: Array<string | null | undefined>): void {
  const now = Date.now()
  for (const p of paths) if (typeof p === 'string' && p) muteDir(dirname(p), now)
}

async function written(...paths: Array<string | null | undefined>): Promise<void> {
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
    !extraWindowOwner &&
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
function keepAwake(on: boolean): void {
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
 * sequence of awaits that drains the shared `pendingOpen` and ends by setting
 * `startupRestored`; a page that dies part way through used to leave it
 * running into the page that replaced it, taking files a second launch had
 * just queued, sending tabs the new page restores itself, and marking a page
 * restored that had not even asked. Every main-frame load and every new
 * window starts a new generation, and a run from an older one stops at its
 * next step and touches nothing shared.
 */
let pageGen = 0

/** A fresh window in place of one whose page keeps dying. The new one is
 *  built FIRST: destroying the only window first would read as the last
 *  window closing, and the app would quit. */
function recreateWindow(): void {
  const old = appState.mainWindow
  createWindow()
  if (old && !old.isDestroyed()) old.destroy()
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
 * blank frame at best.
 */
function ensureLivePage(): boolean {
  if (!app.isReady()) return false // whenReady makes the window and drains the queue
  if (appState.appQuitting || appState.installingUpdate) return false // a window now would only be taken away
  if (!appState.mainWindow || appState.mainWindow.isDestroyed()) {
    logWindow('handoff', { window: 'none', action: 'create' })
    createWindow()
    return true
  }
  if (pageGone(appState.mainWindow)) {
    logWindow('handoff', { window: 'dead', action: 'reload' })
    appState.mainWindow.webContents.reload()
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

function createWindow(): void {
  const remembered = readWindowState()
  const win = new BrowserWindow({
    title: 'Prism',
    width: remembered.width,
    height: remembered.height,
    x: remembered.x,
    y: remembered.y,
    minWidth: 560,
    minHeight: 400,
    show: false,
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
    backgroundColor: '#111318',
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
      // than an IPC message, so it is there before the first render.
      additionalArguments: [
        ...(process.argv.includes('--setup') ? ['--prism-setup'] : []),
        ...(process.argv.includes('--demo') ? ['--prism-demo'] : []),
        // The page's clipboard is main's in-memory one under --e2e (#356);
        // the preload learns it here, since the renderer's argv is its own.
        ...(E2E ? ['--prism-e2e'] : [])
      ]
    }
  })
  appState.mainWindow = win
  pageGen++
  // The diagnostics log's watch (#322): this window's hang events, and its
  // frame for the page's stack when the heartbeat stops. A rebuilt window
  // (#265) is handed over the same way.
  diag?.watchWindow(win)
  // Windows is shutting down or logging off: no will-quit is coming, so the
  // log's last lines (those just before a hang at shutdown) are written here.
  win.on('session-end', () => {
    diag?.log.write('main', 'session-end', {})
    diag?.log.flushSync() // sync-ok: shutdown, the process may be killed right after session-end
  })
  let shown = false
  const showWindow = (): void => {
    if (shown) return
    shown = true
    // Never reopened maximised (owner, 2026-10-11): see windowSize.ts.
    if (E2E) appState.mainWindow?.showInactive()
    else if (appState.mainWindow) raise(appState.mainWindow)
    // No helper to warm (#189): the border program is compiled at build time
    // and started per change with no pipe, so this costs milliseconds and the
    // first frame no longer waits ~900 ms behind a PowerShell's stdin pipe.
    applyDwmBorder()
  }
  appState.mainWindow.once('ready-to-show', showWindow)
  appState.mainWindow.webContents.once('dom-ready', showWindow)
  // The native sweep box's target (#338), once this window has painted.
  win.webContents.once('did-finish-load', () => setTimeout(() => sweepOverlayFor(win), SWEEP_OVERLAY_DELAY_MS))
  guardWindow(win, {
    budget: windowBudget,
    log: logWindow,
    show: showWindow,
    recreate: recreateWindow,
    giveUp: giveUpWindow,
    // The text the page held died with it; a close must not ask about it.
    stateLost: () => {
      appState.editorDirty = false
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
  appState.mainWindow.on('maximize', applyDwmBorder)
  appState.mainWindow.on('unmaximize', applyDwmBorder)
  watchWindowState(appState.mainWindow, flushTabs)
  // Only THIS window's close clears it: a rebuilt window replaces the old one
  // before the old one is destroyed (#265).
  win.on('closed', () => {
    if (appState.mainWindow === win) appState.mainWindow = null
  })
  /**
   * Minimised, and focused, told to the page (2026-08-26).
   *
   * The renderer cannot see either: Electron does not mark a MINIMISED window
   * hidden, so `visibilitychange` never fires and `document.hidden` stays
   * false, and window blur in the page is not the same question as "another
   * application has the focus". The player's "pause in the background" setting
   * needs both, so main - which does know - says so.
   */
  const sayState = (): void =>
    appState.mainWindow?.webContents.send(PUSH.windowState, {
      minimised: appState.mainWindow.isMinimized(),
      focused: appState.mainWindow.isFocused()
    })
  // Listed one by one: BrowserWindow's overloads are per event name, so a loop
  // over a union of them has no single signature to match.
  appState.mainWindow.on('minimize', sayState)
  appState.mainWindow.on('restore', sayState)
  appState.mainWindow.on('show', sayState)
  appState.mainWindow.on('hide', sayState)
  appState.mainWindow.on('focus', sayState)
  appState.mainWindow.on('blur', sayState)

  appState.mainWindow.on('enter-full-screen', () => {
    sendToPage(PUSH.windowFullscreen, true)
    applyMaterial(true)
  })
  appState.mainWindow.on('leave-full-screen', () => {
    sendToPage(PUSH.windowFullscreen, false)
    applyMaterial(false)
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
  appState.mainWindow.webContents.setWindowOpenHandler((d) => {
    if (/^https?:\/\//i.test(d.url)) openLink(d.url)
    return { action: 'deny' }
  })
  // A page cannot navigate the window away from the app either: the renderer
  // is Prism's own UI and nothing in it is a browser.
  appState.mainWindow.webContents.on('will-navigate', (e, url) => {
    const dev = process.env['ELECTRON_RENDERER_URL']
    if (dev && url.startsWith(dev)) return
    if (url.startsWith('file://')) return
    e.preventDefault()
    if (/^https?:\/\//i.test(url)) openLink(url)
  })

  let restoreStarted = false
  appState.mainWindow.webContents.on('did-start-loading', () => {
    restoreStarted = false
    startupRestored = false
    winERequests.reload()
  })
  // The page itself, not a frame inside it: a document preview's iframe
  // loading is no reason to abandon a restore.
  appState.mainWindow.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) pageGen++
  })
  // A shortcut press needs an immediate window even on a cold renderer load.
  // Its solid background is followed by the lightweight opening screen.
  if (winERequest(process.argv)) showWindow()
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void appState.mainWindow.loadURL(devUrl)
  else void appState.mainWindow.loadFile(join(__dirname, '../renderer/index.html'))

  // Rebuild last session's strip, then deliver whatever the app was launched
  // with. Order matters: the launch file goes through the same arriving-file
  // rule as everything else, so double-clicking a photo in a folder that was
  // already open lands in that tab rather than opening a second copy of it.
  // The lightweight loading shell can finish its document before App loads.
  // Start restore only once the renderer is actually listening for its files.
  const restoreWhenListening = (event: Electron.IpcMainEvent): void => {
    if (!isMainSender(event.sender)) return
    if (restoreStarted) {
      if (startupRestored) event.sender.send(PUSH.openRestored)
      return
    }
    restoreStarted = true
    const gen = pageGen
    const stale = (): boolean => gen !== pageGen
    // SEQUENTIAL, and that is the whole point of the IIFE (2026-08-31). These
    // became async when listDir did, and firing them off together would let
    // the launch file race the restored tabs: the arriving-file rule folds a
    // file into a tab whose root already holds it, so a launch file that
    // arrives BEFORE its own restored tab spawns a duplicate instead.
    void (async () => {
      // "Remember tabs" (owner, 2026-09-22), off: a COLD start opens only the
      // Explorer tab and what Prism was opened with. Once per process, so a
      // reload of the window in the same session still gets its tabs back; the
      // tabs are saved either way.
      const remember = windowPreferences.load().values['prism.tabs.remember'] !== 'off'
      const skip = !remember && !coldRestoreDone
      coldRestoreDone = true
      // A page back from more than one death in a row comes back without its
      // saved tabs (#265, review): one of them may be what kills it, and
      // restoring it at every recovery ends in the give-up, then the same
      // give-up at every later launch. The Explorer tab and the files handed
      // over still arrive; the log says the tabs were left out.
      const strained = windowBudget.strained(Date.now())
      if (strained && !skip && !extraWindowOwner) logWindow('restore', { tabs: 'skipped', reason: 'repeated-deaths' })
      const send = (payload: OpenPayload): void => {
        if (!stale()) sendToPage(PUSH.openFile, payload)
      }
      // The home Explorer first when no pinned one was saved (#271): it is
      // the tab the window opens on, and a names-only read is 1 to 3 ms.
      const saved = extraWindowOwner || skip || strained ? null : readTabs(userPaths.tabs())
      const sendHome = async (): Promise<void> => {
        const id = `explorer-home-${Date.now()}`
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
      const pinnedSent = saved ? await restoreTabs(send, saved) : false
      if (stale()) return
      // A saved pinned Explorer whose folder has gone: the home one stands in.
      if (pinnedSaved && !pinnedSent) await sendHome()
      if (stale()) return
      // In argv order, each through the ordinary arriving-file route, so
      // several files from one folder still fold into ONE tab and the last
      // named ends up in front - the one a "prism a.jpg b.jpg" reader means.
      // New OS opens can arrive while a slow restore is still draining. Shift
      // the shared queue so those requests are preserved in arrival order too.
      while (pendingOpen.length && !stale()) await sendOpen(pendingOpen.shift()!)
      if (stale()) return
      winERequests.restored()
    })()
      .catch((error: unknown) => console.error('Could not restore the startup session:', error))
      .finally(() => {
        if (stale()) return
        startupRestored = true
        // A handoff's paths are stat'ed awaited (2026-10-12), so one can land
        // in the queue just after the drain above ended: it opens now.
        if (pendingOpen.length)
          void (async () => {
            while (pendingOpen.length && !stale()) await sendOpen(pendingOpen.shift()!)
          })()
        // A genuinely empty or failed restore may show the ordinary empty state.
        // Until this signal, no tabs means the initial folders are still loading.
        if (!event.sender.isDestroyed()) event.sender.send(PUSH.openRestored)
      })
  }
  ipcMain.on(CALL.openListen, restoreWhenListening)
  appState.mainWindow.once('closed', () => ipcMain.removeListener(CALL.openListen, restoreWhenListening))
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
  // Prism's own writes: muted for the watcher, then sizes refreshed.
  ownWrite,
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
  extraWindowOwner,
  preferencesLoaded,
  preferencesOwner,
  winERequests,
  shellVerbSetting,
  saveTabs,
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
   * ends, and two writers on one file would interleave their batches. An
   * extra Explorer window (Win+E) runs on its own profile, so it keeps its
   * own log there and never shares the owner's file.
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
  void app.whenReady().then(() => startNativeTrace({ log: traceLog, tracing: contentTracing }))
  // E2E only (review of #322): the harness ends a scenario with `app.exit`,
  // which skips will-quit, so it writes main's queue first and the run's
  // Stalls table sees a scenario's last moments.
  // sync-ok: e2e only, the harness calls it just before app.exit
  if (E2E) Object.assign(globalThis, { __e2eDiagFlush: () => diag?.log.flushSync() })
  markExplorerWindow(userPaths.root(), false)
  app.on('second-instance', (_e, argv) => {
    const shortcutRequest = winERequest(argv)
    if (shortcutRequest) {
      if (appState.installingUpdate) return
      void Promise.all([app.whenReady(), preferencesReady])
        .then(() => {
          return launchExplorerWindow({
            owner: preferencesOwner,
            id: shortcutRequest,
            executable: process.execPath,
            packaged: app.isPackaged,
            appPath: app.getAppPath(),
            argv: process.argv,
            browse: browseRequest(argv)
          })
        })
        .catch(() => {
          /* The helper falls back if the new window cannot launch. */
        })
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
    // A new page restores and drains `pendingOpen` itself once it listens.
    if (ensureLivePage()) startupRestored = false
    // The handoff is the case the foreground lock bites hardest: Prism has
    // been sitting in the background for an hour, and the file it is handed
    // must arrive in a window that is actually in front of you. Raised FIRST,
    // before the paths are even read, so the foreground-lock fix runs the
    // instant the handoff arrives.
    if (appState.mainWindow) {
      if (E2E) appState.mainWindow.show()
      else raise(appState.mainWindow)
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
        if (!startupRestored) pendingOpen.push(...paths)
        else if (appState.mainWindow) {
          // Awaited INSIDE the chain (2026-10-16): fired and forgotten, a
          // later handoff's opens could overtake this one's, and the wrong tab
          // ended up in front. One path that fails still lets the rest open.
          for (const p of paths) await sendOpen(p).catch(() => {})
        }
      })
      .catch(() => {
        /* a handoff that cannot be read opens nothing */
      })
  })

  pendingOpen = pathsFromArgv(process.argv) // sync-ok: startup, before the first window
  const shortcutRequest = winERequest(process.argv)
  const browse = browseRequest(process.argv)
  if (shortcutRequest && browse) winEBrowse.set(shortcutRequest, browse)
  if (shortcutRequest) winERequests.enqueue(shortcutRequest)

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
    markExplorerWindow(userPaths.root(), true)
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
    void cleanExplorerWindows(preferencesOwner)
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
      if (appState.mainWindow && !appState.mainWindow.isDestroyed())
        appState.mainWindow.webContents.send(PUSH.windowPreferencesChanged, snapshot)
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
    registerPreferencesIpc(ctx)
    registerWinEIpc(ctx)
    protocol.handle(MEDIA_SCHEME, (request) => serveMedia(request))
    protocol.handle(AUDIO_SCHEME, (request) =>
      serveSidecarAudio(request, {
        allowed: readable,
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

    startUpdates(preferencesOwner)
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

    createWindow()
    void shellVerbSetting.status()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    // Nothing can be playing without a window, and a block that outlives the
    // thing it was held for is a laptop that never sleeps again.
    keepAwake(false)
    closeAllWatches()
    stopAllTails()
    if (process.platform !== 'darwin') app.quit()
  })
}
