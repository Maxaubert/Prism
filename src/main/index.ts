import { startLagProfiler } from './lagProfiler'
import { startNativeTrace } from './nativeTrace'
import { CALL, PUSH } from '@shared/channels'
import { app, protocol, shell, BrowserWindow, ipcMain, contentTracing, crashReporter, utilityProcess, Menu, powerMonitor, powerSaveBlocker, session, clipboard, nativeImage } from 'electron'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import { answerE2eClipboard, installFakeClipboard } from './e2eClipboard'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { performance } from 'perf_hooks'
import { initDwmHelper } from './dwmHelper'
import { pathsFromArgv } from './argv'
import { WIN_E_FIRST, browseRequest, createWinERequests, shortId, winERequest, winEHostOf } from './winERequests'
import { bootFields, createStartupLog, launchReason, type Launch } from './startupLog'
import { createSpareIdle } from './spareIdle'
import { lastWindowClosed, standbyWanted, type QuitReason } from './standby'
import { startWakePipe, wakePipeName } from './wakePipe'
import { createWindowPreferences } from './windowPreferences'
import { forgetCanonical, listDir, toViewerFile, warmCanonical } from './dirList'
import { grantDesktopDirectory, insideDesktop } from './desktopAccess'
import { type BrowseRead } from './browse'
import { MemberTemp } from './memberTemp'
import { createArchiveBrowse } from './archiveBrowse'
import { placeOf } from '@shared/archivePlace'
import { createListingCache } from './listingCache'
import { createExplorerListings } from './explorerListing'
import { isLocalFixed } from './driveKinds'
import { FolderSizeCache } from './folderSizeCache'
import { getIndexedFolderSizes } from './everythingBrowse'
import { initializeIndexerRuntime, indexerInstance } from './indexerRuntime'
import { findRunningEverything } from './existingEverything'
import { HlsJobs } from './phone/jobs'
import { PhoneLog } from './phone/diag'
import { Positions } from './positions'
import { readSessionRaw, type SavedTabs } from './tabs'
import { savedEntry } from './session'
import { userPaths } from './paths'
import { haveInstanceLock } from './instanceLock'
import { startDiagnostics, type Diagnostics } from 'prism-term-core/main/diagnostics'
import { withStackPolicy } from 'prism-term-core/main/diagIpc'
import { LONG_WAIT_CHANNELS } from './diagChannels'
import { mainCrumb } from './diagCrumb'
import { binListing } from './binList'
import { binDirs } from './binRoots'
import { watchOps } from './opLog'
import { AUDIO_SCHEME, killSidecars, serveSidecarAudio } from './audioSidecar'
import {
  cancelAllConversions
} from './videoConvert'
import { createShellVerbSetting } from './shellVerbSetting'
import { type TextShape } from './textFile'
import { stopAllTails } from './fileTail'
import {
  setSevenExe,
  setZipFork
} from './archive'
import { crashBudget } from './crashBudget'
import { createWindowRecovery } from './windowRecovery'
import { createOpenQueue } from './openQueue'
import type { MainCtx, ReadyCtx } from './ipc/context'
import { crashLogSettled } from './crashLog'
import pkg from '../../package.json'
import type { DirChange, OpenPayload } from '@shared/types'
import { exists } from './fsUtil'
import { E2E, appState, windows } from './appState'
import { createPathWall } from './pathWall'
import { MEDIA_SCHEME, createMediaServer } from './mediaProtocol'
import { isLiveRequest, type LiveVideo } from './liveVideo'
import { heicToJpeg } from './heicClient'
import { ffmpegTools, sevenExe } from './bundledTools'
import { registerArchiveIpc, type ArchiveBodies } from './ipc/archive'
import { registerDragIpc } from './ipc/drag'
import type { DragOut } from './dragOut'
import type { NativeDragRecord } from '@shared/dragOut'
import { clearFakeDrags, fakeDragCalls } from './e2eDragOut'
import { registerMediaIpc } from './ipc/media'
import { registerThumbsIpc } from './ipc/thumbs'
import { registerPropsIpc } from './ipc/props'
import { registerBrowseIpc, registerTreeIpc } from './ipc/browse'
import { registerLinkIpc } from './ipc/links'
import { installPermissionHandler } from './permissions'
import { registerSaveCopyIpc, registerFilesIpc, registerShellIpc, registerMoveIpc, registerNewFilesIpc } from './ipc/files'
import { registerOpenIpc } from './ipc/open'
import { registerFolderIconIpc } from './ipc/folderIcons'
import { registerSessionIpc } from './ipc/window'
import { registerTearIpc, registerPreviewWindowIpc } from './ipc/tabs'
import { createTabsSession } from './tabsSession'
import { startUpdates } from './updateFlow'
import { registerPositionsIpc, type PhoneService } from './phone'
import { registerWindowIpc } from './windowChrome'

import { createMainState } from './mainState'
import { createWindowFactory, coldStartFlags } from './windowFactory'
import { createLaunchRouter } from './launchRouter'
import { wirePreferences } from './startup/preferences'
import { createProbeCached } from './startup/probe'
import { wireThumbs } from './startup/thumbs'
import { wireLiveVideo } from './startup/liveVideo'
import { wirePhone } from './startup/phone'
import { installE2eWindowHooks } from './startup/e2eHooks'
import { wireTearOff } from './startup/tearWiring'
import { createSweepWiring } from './startup/sweepWiring'
import { createStandbyParts } from './startup/standbyParts'
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
// THE E2E IS SILENT (owner, 2026-11-09: "the tests you run like now play the
// videos audio and its distracting"). Chromium's own switch for automated runs:
// the sound goes to no device, while the clock, the element and the analyser
// behave as they do when heard. `launchTestApp` refuses a run without it.
if (process.argv.includes('--e2e')) app.commandLine.appendSwitch('mute-audio')

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
  heic: heicToJpeg,
  // fsmedia://thumb/<key>: the desktop's tile pictures, from this folder only.
  thumbsDir: () => userPaths.thumbs(),
  // A 500 leaves a line in the diag log (review of #23). `diag` is made at
  // ready, before any page can ask for media.
  onError: (fields) => diag?.log.write('main', 'media-500', fields)
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
/** `fsmedia://live/...`, the desktop's live transcodes (liveVideo.ts). Made
 *  at ready, with the phone's jobs; until then nothing can have asked. */
let liveVideo: LiveVideo | null = null

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
  // The bin folders the app reads, for the e2e to compare with its seam list:
  // the proof that a run never looked at the real bin (Recycle Bin, D22).
  ;(globalThis as typeof globalThis & { __prismBinDirs?: typeof binDirs }).__prismBinDirs = binDirs
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
  // The Recycle Bin (D5): read directly, never cached on disk. A record that
  // could not be read is counted in one diagnostics line, never a broken row.
  bin: async () => {
    const { listing, skipped } = await binListing(await binDirs(), undefined, (files, folders) => wall.grantBin(files, folders))
    if (skipped) mainCrumb('bin-skipped', { count: skipped })
    return listing
  },
  // E2E only: the slow-folder hint is proved by holding every names read, and
  // a details patch that lands after a select and a scroll by holding those.
  delayMs: process.argv.includes('--e2e') ? Number(process.env.PRISM_E2E_LIST_DELAY) || 0 : 0,
  detailsDelayMs: process.argv.includes('--e2e') ? Number(process.env.PRISM_E2E_DETAILS_DELAY) || 0 : 0
})
/** The tab strips across launches, one entry per window (tabsSession.ts). */
const { restoreTabs, session: sessionFile } = createTabsSession({
  cachedListing: (path) => explorerListings.cachedAsync(path),
  archiveRead: (tabId, path) => archiveRead(tabId, path),
  binRead: (tabId, path) => explorerListings.browse(tabId, path, false),
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
const winERequests = createWinERequests(
  (id, host, browse) => {
    const to = windows.all().find((r) => winEHostOf(r) === host)
    const path = browse ?? (host === WIN_E_FIRST ? null : newTabFolder())
    windows.sendTo(to, PUSH.winEOpen, { id, path })
  },
  undefined,
  undefined,
  undefined,
  // EACH PRESS ON PRISM'S OWN TIMELINE (owner, 2026-11-06): received,
  // handed to its window, answered (the helper told the folder is up) or
  // dropped, and repeats that rode on an earlier press.
  (ev, fields) => {
    diag?.log.write('main', 'win-e', { ev, ...fields })
    if (ev !== 'acked' || typeof fields.id !== 'string') return
    for (const [id, l] of launchOfRequest)
      if (shortId(id) === fields.id) {
        l.mark('winEAck')
        launchOfRequest.delete(id)
      }
    if (state.hotkeyOpening && shortId(state.hotkeyOpening.id) === fields.id) state.hotkeyOpening.ackedAt = Date.now()
  }
)
/** The launch (or wake) each Win+E request is timed under (`startupLog.ts`). */
const launchOfRequest = new Map<string, Launch>()
/** When each pending Win+E request reached this process (ms), for its `shown` line. */
const requestReceived = new Map<string, number>()
/** Process state shared by the window factory, the launch router and the quit path (mainState.ts). */
const state = createMainState()
/** One `win-e` line from main's own steps. */
function winELine(ev: string, fields: Record<string, unknown>): void {
  diag?.log.write('main', 'win-e', { ev, ...fields })
}
const openQueue = createOpenQueue({ windows, exists })
/** Subtitle files the user chose in the dialog: reading those is allowed
 *  wherever they live, because choosing them in main's own dialog is the
 *  consent the root wall exists to ask for. */
const pickedSubs = new Set<string>()

/** The phone switch, its port and the paired phones (#104). */

/**
 * A WEB LINK LEAVES THE APP HERE, AND NEVER UNDER --e2e (#222; owner,
 * 2026-09-24: "make sure that future runs don't do that in my real browser").
 * The terminal scenarios print and click https://example.com links, and every
 * run opened them as tabs in the owner's own browser. Under --e2e the link is
 * RECORDED on `globalThis.__e2eOpenedLinks` for the e2e to read, and nothing
 * outside the app is started.
 */
/** The drag out of Prism (#103, ipc/drag.ts), once the handlers exist. */
let dragOut: DragOut | null = null
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
function folderChanged(change: DirChange): void {
  // Our index and cache writes must not invalidate themselves recursively.
  // The changed entries when the watch named them (owner, 2026-11-18): one
  // child's change stales that child and the folder, not every sibling.
  const directories = (change.entries ?? change.dirs).filter((path) =>
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
    .invalidate(directories, tell, { soft: true })
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
/** The launch timings (startupLog.ts): one `startup` line per launch and wake. */
const startup = createStartupLog({
  write: (fields) => diag?.log.write('main', 'startup', fields),
  up: () => Math.round(performance.now())
})
/** A watcher set-up this slow is said at the quiet level (#322). */
const SLOW_SETUP_MS = 50
/** A folder size scan this long is said at the quiet level (#322). */
const SLOW_SCAN_MS = 500
app.on('before-quit', () => (appState.appQuitting = true))
/** E2E only: a dead page stays dead, as the bug left it, so the watchdog and
 *  the second launch can be proved as the nets they are. */
const holdRecovery = E2E && process.env.PRISM_E2E_HOLD_RECOVERY === '1'
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

const { logWindow, recreateWindow, giveUpWindow, ensureLivePage, openAsFirst } = createWindowRecovery({
  createWindow: (options) => createWindow(options),
  firstWindowMade: () => state.firstWindowMade,
  quitBecause: (reason) => {
    state.quitReason ??= reason
  },
  sessionFile,
  windowPreferences
})

/**
 * THE NATIVE SWEEP BOX (#338; src/main/sweepOverlay.ts, startup/sweepWiring.ts):
 * started lazily, once, after the first window has painted (#189: nothing on
 * the startup path), and every window after that gets its target the same way.
 */
const { sweepOverlayFor, loaded: sweepLoaded } = createSweepWiring()
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
 * (made at the first quiet spell after startup and after each use, spareIdle.ts,
 * 2026-11-06; it was a 2 s timer) so a torn-off tab is in a real
 * window under the cursor within a frame or two. Under --e2e there is a spare
 * only when the scenario asks (`PRISM_E2E_SPARE=1`): a window appearing by
 * itself 2 s in would change what every other scenario counts.
 */
const spareWanted = (): boolean => !E2E || process.env.PRISM_E2E_SPARE === '1'
/** When anything last happened that a spare must not compete with. */
let lastActivity = Date.now()
function noteActivity(): void {
  lastActivity = Date.now()
}
/**
 * THE SPARE IS MADE WHEN PRISM IS IDLE (owner, 2026-11-06; spareIdle.ts):
 * never on a startup timer, never in standby, and given up for the session
 * when making it was slow or its page never got ready.
 */
const spareIdle = createSpareIdle({
  now: Date.now,
  lastActivity: () => lastActivity,
  settled: () => state.startupSettled,
  allowed: () => {
    if (!spareWanted() || standby.on() || appState.appQuitting || appState.installingUpdate) return false
    if (windows.count() === 0) return false
    const s = windows.spare()
    return !s || tear.busy(s.win)
  },
  make: () => {
    // The ghost is made with it (owner, 2026-10-30), so the first tear shows
    // the tab under the cursor at once.
    tabGhost.warm()
    createWindow({ spare: true, seed: { kind: 'adopt' } })
  },
  drop: () => {
    for (const r of windows.all()) if (r.spare && !r.win.isDestroyed() && !tear.busy(r.win)) r.win.destroy()
  },
  log: (fields) => diag?.log.write('main', 'spare-slow', fields)
})
function spareSoon(): void {
  // No spare wanted (an e2e that did not ask): no wait polling for one.
  if (spareWanted()) spareIdle.want()
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
  spareIdle.cancel()
  for (const r of windows.all()) if (r.spare && !r.win.isDestroyed()) r.win.destroy()
  tabGhost.destroy()
}
const { tabGhost, previewWindows, tear } = wireTearOff({
  sessionFile,
  takeSpare,
  spareSoon: () => spareSoon(),
  sweepLoaded
})
/** The one place a Prism window is made (windowFactory.ts). */
const createWindow = createWindowFactory({
  state,
  diag: () => diag,
  sessionFile,
  restoreTabs,
  windowPreferences,
  explorerListings,
  winERequests,
  openQueue,
  spareIdle,
  previewWindows,
  tear,
  windowBudget,
  recovery: { logWindow, recreateWindow, giveUpWindow },
  requestReceived,
  playing,
  holdAwake,
  noteActivity,
  spareSoon,
  replaceSpare,
  dropSpare,
  sweepOverlayFor,
  winELine,
  openLink,
  holdRecovery
})
/** The lag profiler (made with the log, once the lock is won): off in standby. */
let lagProfiler: { rotate(): void } | null = null
/** The phone server's standby half (made at ready). */
let phoneService: PhoneService | null = null
/**
 * STANDBY'S PARTS (standby.ts, startup/standbyParts.ts; owner, 2026-11-06:
 * "a mode that doesnt use much compute ram"). In the order they rest; they
 * wake in reverse.
 */
const standby = createStandbyParts({
  diag: () => diag,
  lagProfiler: () => lagProfiler,
  phoneService: () => phoneService,
  dropSpare,
  previewWindows
})

/** What the IPC handlers in ipc/ reach (`MainCtx`, ipc/context.ts): index.ts's own state and helpers. */
const ctx: MainCtx = {
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

// Single instance: a second launch (opening another file) forwards its path to
// the running window and focuses it, instead of spawning a rival process. The
// lock is taken by boot.ts before this file loads (2026-11-28); a process that
// lost it never gets here, and boot.ts logs its `lock-lost`.
if (!haveInstanceLock()) {
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
  // What this launch was handed, read once (sync-ok: startup, before the
  // first window), for the session line's reason and the first window.
  const launchPaths = pathsFromArgv(process.argv) // sync-ok: startup, before the first window
  const argvRequest = winERequest(process.argv)
  const coldReason = launchReason({ winE: !!argvRequest, paths: launchPaths })
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
    verboseByDefault: !E2E,
    // HOW THIS PROCESS STARTED (owner, 2026-11-06): when the OS made it,
    // how long it took to reach this line (the part of a cold start no
    // Prism code saw: 3.77 s of the owner's 5.6 s on Nov 5), and why.
    sessionFields: {
      ...(bootFields(process.getCreationTime(), Date.now()) ?? {}),
      reason: coldReason,
      ...(argvRequest ? { winE: shortId(argvRequest) } : {}),
      ...(browseRequest(process.argv) ? { browse: true } : {})
    },
    // Which window a page-stall came from, and whether anyone could see it.
    pageInfo: (page) => {
      const r = windows.all().find((x) => x.id === page)
      if (!r) return null
      return { win: r.key, hidden: r.win.isDestroyed() || !r.win.isVisible(), ...(r.spare ? { spare: true } : {}) }
    }
  })
  /** This cold launch, timed to its first window's folder (startupLog.ts). */
  const coldLaunch = startup.begin(coldReason, { from: 0, winE: !!argvRequest })
  if (argvRequest) {
    launchOfRequest.set(argvRequest, coldLaunch)
    requestReceived.set(argvRequest, Date.now())
    winELine('received', { id: shortId(argvRequest), path: 'cold', via: 'argv', browse: !!browseRequest(process.argv) })
  }
  // EVERY FILE OPERATION SAYS HOW IT WENT (owner, 2026-11-06: "make sure
  // logs are always on so you can see what happened"): an `op` line per
  // rename, move, trash, extract, zip write, save..., at every level. Here,
  // before any channel is registered, like the timing above (opLog.ts).
  watchOps(ipcMain)
  // A main-lag of 1 s or more carries a CPU profile (2026-10-12) and a
  // Chromium trace (2026-10-27), in every session (owner, 2026-10-27, "keep
  // logging as much as possible"): the profile says what JavaScript did, the
  // trace what Electron and Chromium did when JavaScript sat idle
  // (lagProfiler.ts, nativeTrace.ts). Nothing is written without a lag.
  // An OS drag out of Prism (#103) is Windows' modal loop on main: a lag
  // during it, or just after, is the drag, not a stall to profile.
  // Off in standby (2026-11-06): 250 samples a second of a thread doing nothing.
  lagProfiler = startLagProfiler({ log: diag.log, enabled: () => !standby.on(), quiet: () => dragOut?.quiet() ?? false })
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
  // `workingDirectory` is the SECOND process's cwd (#21): its relative paths
  // are read against it, never against this process's own.
  const onLaunch = createLaunchRouter({
    state,
    diag: () => diag,
    noteActivity,
    standby,
    startup,
    winERequests,
    requestReceived,
    launchOfRequest,
    winELine,
    openQueue,
    recovery: { ensureLivePage, openAsFirst },
    createWindow
  })
  app.on('second-instance', (_e, argv, workingDirectory) => onLaunch(argv, workingDirectory, 'second-instance'))
  // The hotkey pipe, once the app is ready (a request before then goes the
  // old way: the helper starts a Prism, which hands over).
  void app.whenReady().then(() =>
    startWakePipe({
      name: wakePipeName(preferencesOwner),
      exe: process.execPath,
      onRequest: (argv) => {
        if (appState.appQuitting || appState.installingUpdate) return false
        onLaunch(argv, process.cwd(), 'pipe')
        return true
      },
      log: (fields) => diag?.log.write('main', 'win-e', fields)
    })
  )

  openQueue.set(launchPaths)
  const shortcutRequest = argvRequest
  const browse = browseRequest(process.argv)
  if (shortcutRequest) {
    winERequests.enqueue(shortcutRequest, WIN_E_FIRST, browse)
    // The cold start's own press: a repeat while its window opens rides on it.
    state.hotkeyOpening = { id: shortcutRequest, browse, ackedAt: null, closed: false, win: null }
  }

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
    // The kills inside are synchronous; the folder goes at the next start.
    void liveVideo?.stopAll()
    const reason: QuitReason =
      state.quitReason ?? (appState.installingUpdate ? 'update' : state.sessionEnded ? 'session-end' : 'user')
    // The quit is going ahead: the log's queue is written synchronously, so
    // its last lines land. LAST (review of #322): the shell, sidecar and
    // conversion teardown above is where a quit goes wrong (PT #127), and a
    // stopped log would hear nothing of it.
    diag?.stop(reason)
    diag = null
  })

  app.whenReady().then(() => {
    coldLaunch.mark('ready')
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
    wirePreferences(ctx)
    protocol.handle(MEDIA_SCHEME, (request) =>
      liveVideo && isLiveRequest(request.url) ? liveVideo.serve(request) : serveMedia(request)
    )
    protocol.handle(AUDIO_SCHEME, (request) =>
      serveSidecarAudio(request, {
        allowed: readable,
        warm: warmWall,
        packaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        appPath: app.getAppPath()
      })
    )

    // One probe per file, kept for as long as the file has not changed (startup/probe.ts).
    const probeCached = createProbeCached()

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
    // The phone grid's pictures (startup/thumbs.ts).
    const thumbs = wireThumbs(hlsTools)
    const hlsJobs = hlsTools
      ? new HlsJobs({ ffmpeg: hlsTools.ffmpeg, baseDir: HLS_DIR, log: logPhone })
      : null
    void rm(HLS_DIR, { recursive: true, force: true }).catch(() => undefined)
    // The desktop's live transcode (startup/liveVideo.ts).
    liveVideo = wireLiveVideo(hlsTools, readable)

    // The archive bodies the phone shares, from `registerArchiveIpc` below.
    let archiveBodies: ArchiveBodies | null = null
    const { phoneService: phone, readTextWalled, docHtmlOf } = wirePhone({
      ctx,
      rendererDir: RENDERER_DIR,
      serveMedia,
      probeCached,
      hlsJobs,
      positions,
      thumbs,
      logPhone,
      archiveBodies: () => archiveBodies!
    })
    phoneService = phone

    /** What the IPC handlers in ipc/ need that only exists now (`ReadyCtx`). */
    const ready: ReadyCtx = { positions, readTextWalled, probeCached, docHtmlOf, live: liveVideo }

    startUpdates()
    registerOpenIpc()
    registerFolderIconIpc()
    registerSaveCopyIpc(ctx)
    registerLinkIpc(ctx)
    installPermissionHandler()
    registerBrowseIpc(ctx)
    registerSessionIpc(ctx)
    registerTreeIpc(ctx)
    registerFilesIpc(ctx, ready)
    registerThumbsIpc(ctx, thumbs)
    registerPropsIpc(ctx)
    registerMediaIpc(ctx, ready)
    registerShellIpc(ctx)
    registerMoveIpc(ctx, ready)
    archiveBodies = registerArchiveIpc(ctx)
    dragOut = registerDragIpc(ctx, archiveBodies)
    // The e2e's view of the drag out (#103): what main would have handed
    // startDrag, ending the recorded drag, and a record for any paths.
    if (E2E) {
      const d = dragOut
      Object.assign(globalThis, {
        __e2eDragOut: {
          calls: fakeDragCalls,
          clear: clearFakeDrags,
          end: () => d.endFake(),
          start: (paths: string[], cargo?: NativeDragRecord['cargo']) => d.startFake(paths, -1, cargo),
          inFlight: () => d.inFlight(),
          prepared: () => d.preparedCopies()
        }
      })
    }
    registerNewFilesIpc(ctx)

    registerWindowIpc()
    registerTearIpc(tear)
    registerPreviewWindowIpc(previewWindows)

    // THE SESSION'S FIRST WINDOW, and the only one that reads the saved strip
    // (2026-10-29): the session file is read once, here, before it exists, so
    // it opens at its saved size; its restore filters the strip from the same
    // text when its page listens.
    state.sessionRaw = readSessionRaw(userPaths.tabs()) // sync-ok: startup, before the first window (inside readSessionRaw)
    const firstWin = createWindow({
      first: true,
      seed: { kind: 'saved' },
      launchFlags: coldStartFlags(),
      saved: savedEntry(state.sessionRaw),
      launch: coldLaunch
    })
    if (state.hotkeyOpening && !state.hotkeyOpening.win) state.hotkeyOpening.win = firstWin
    void shellVerbSetting.status()
    app.on('activate', () => {
      if (windows.count() === 0) ensureLivePage()
    })
    installE2eWindowHooks({ createWindow, tear, tabGhost })
  })

  app.on('window-all-closed', () => {
    // Nothing can be playing without a window, and a block that outlives the
    // thing it was held for is a laptop that never sleeps again.
    playing.clear()
    holdAwake(false)
    stopAllTails()
    // STANDBY (owner, 2026-11-06; standby.ts): the last window's close
    // leaves the process resting, unless a quit, an update, a log-off or
    // the switch says it goes.
    const next = lastWindowClosed({
      quitting: appState.appQuitting,
      installingUpdate: appState.installingUpdate,
      sessionEnded: state.sessionEnded,
      wanted: standbyWanted(windowPreferences.load().values, E2E, process.env)
    })
    if (next.standby) {
      standby.enter()
      return
    }
    if (next.reason) state.quitReason ??= next.reason
    app.quit()
  })
  // Windows logging off or shutting down while Prism rests: no window is
  // there to hear `session-end`, so the power monitor's word is taken.
  void app.whenReady().then(() =>
    powerMonitor.on('shutdown', () => {
      state.sessionEnded = true
      state.quitReason ??= 'session-end'
      diag?.log.write('main', 'session-end', { standby: standby.on() })
      diag?.log.flushSync() // sync-ok: shutdown, the process may be killed right after
    })
  )
}
