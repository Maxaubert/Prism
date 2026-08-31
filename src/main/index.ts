import {
  app,
  protocol,
  shell,
  screen,
  BrowserWindow,
  ipcMain,
  dialog,
  nativeTheme,
  utilityProcess,
  Menu,
  powerSaveBlocker
} from 'electron'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'path'
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from 'fs'
import { copyFile, readFile, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { execFile, spawn } from 'child_process'
import { Readable } from 'stream'
import { pathsFromArgv } from './argv'
import { isSkipped, listDir, searchFiles, toViewerFile } from './dirList'
import { addRoot, dropRoot, insideAnyRoot, isAnyRoot, onRootsChanged, validRoot } from './roots'
import { closeAllWatches, muteDir, unwatchRoot, watchRoot } from './dirWatch'
import { readTabs, writeTabs, type SavedTabs } from './tabs'
import { detectShells } from './shells'
import {
  killAll,
  killTerm,
  killWarm,
  livePids,
  ptyOutputTicks,
  prewarmShell,
  resizeTerm,
  spawnTerm,
  writeTerm
} from './terminal'
import { parseProcLines, treeAgentKind } from './agentDetect'
import { documentImages, isMarkdownPath } from './docImages'
import { AUDIO_SCHEME, killSidecars, serveSidecarAudio } from './audioSidecar'
import { FIRST_AUDIO, findFfmpeg, needsSidecar, probeMedia, type MediaInfo } from './ffmpeg'
import { decodableImages, decodeImage, needsImageDecode, tiffPages } from './imageDecode'
import {
  cancelAllConversions,
  cancelConversion,
  convertVideo,
  planConversion
} from './videoConvert'
import { cachedPeaks, loadPeaks } from './peaks'
import {
  bundledSeven,
  extractAllSeven,
  extractSeven,
  extractSevenSubtree,
  extractSevenTo,
  isSevenArchive,
  listSeven
} from './sevenZip'
import { convertDoc, docKind } from './docConvert'
import { findFluid, isMidi, renderMidi } from './midi'
import { installVerb, removeVerb, verbInstalled } from './shellVerb'
import { isRaw, rawPreview } from './rawPreview'
import { photoInfo, type PhotoInfo } from './photoInfo'
import { sanitizeDoc } from './docSanitize'
import { encodeText, shapeOf, type TextShape } from './textFile'
import { readTail, startTail, stopAllTails, stopTail } from './fileTail'
import { openComic } from './comic'
import { renameFile, uniqueName } from './fileOps'
import { appsForExt, argsFor, type AppCandidate } from './openWith'
import { readAsVtt, sidecarsFor, type SubTrack } from './subtitles'
import {
  addToArchive,
  archiveStat,
  archiveTooLarge,
  deleteMember,
  extractMember,
  extractTo,
  listArchive,
  moveMembers,
  renameMember,
  setSevenExe,
  type ArchiveStat
} from './archive'
import { insideSelf, moveEntries } from './moveOps'
import { installUpdate, watchForUpdates, type UpdateInfo } from './update'
import { fileKind } from '@shared/fileKind'
import type {
  ArchiveListing,
  DirListing,
  FileKind,
  OnClash,
  OpenPayload,
  OpenWithApp,
  MediaProbe,
  RenameResult,
  TextRead,
  WriteResult
} from '@shared/types'

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

// Archive members extracted to temp for viewing: each grant is one exact
// path, made when archive:extract writes it. The reads that honour the root
// wall (file:text, file:copy-clip) accept these too; writes never do.
const extractedPaths = new Set<string>()

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

const MEDIA_SCHEME = 'fsmedia'
/** file:text's contract is a text file, not a log nobody can read: 64MB
 *  crosses the bridge as one string and lands in one CodeMirror doc. */
const TEXT_MAX_BYTES = 64 * 1024 * 1024

/* ------------------------------------------------------------------ *
 * The agent poll's shape. See the poll itself for why it is like this.
 * ------------------------------------------------------------------ */
const AGENT_POLL_MIN = 2500
const AGENT_POLL_MAX = 20000
/**
 * "pid ppid" for everything, plus the command line only where a cheap word
 * match hits. The full dump with every command line was megabytes; this is a
 * few KB. The prefilter is deliberately BROAD - the strict signatures live in
 * agentDetect, which sees whatever this lets through.
 */
const AGENT_QUERY =
  'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CommandLine | ' +
  'ForEach-Object { if ($_.CommandLine -and $_.CommandLine -match ' +
  "'claude|codex|aider|gemini') " +
  '{ "$($_.ProcessId) $($_.ParentProcessId) $($_.CommandLine)" } ' +
  'else { "$($_.ProcessId) $($_.ParentProcessId)" } }'
protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    // corsEnabled so an <audio crossorigin> element served over fsmedia:// is not
    // "tainted" — otherwise a MediaElementSource feeds the AnalyserNode silence and
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

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  // Served only until the converted copy exists (videoConvert.ts).
  '.wmv': 'video/x-ms-wmv',
  '.asf': 'video/x-ms-asf',
  '.flv': 'video/x-flv',
  '.f4v': 'video/x-f4v',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.mpe': 'video/mpeg',
  '.m1v': 'video/mpeg',
  '.m2v': 'video/mpeg',
  '.mpv': 'video/mpeg',
  '.m2ts': 'video/mp2t',
  '.vob': 'video/dvd',
  '.3gp': 'video/3gpp',
  '.3g2': 'video/3gpp2',
  '.divx': 'video/x-msvideo',
  '.mxf': 'application/mxf',
  '.rm': 'application/vnd.rn-realmedia',
  '.rmvb': 'application/vnd.rn-realmedia-vbr',
  '.ogm': 'video/ogg',
  '.dv': 'video/x-dv',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  // The rest reach the player as decoded PCM (audioSidecar), so these types
  // only matter for the few Chromium can read by itself.
  '.mka': 'audio/x-matroska',
  '.m4b': 'audio/mp4',
  '.wma': 'audio/x-ms-wma',
  '.ac3': 'audio/ac3',
  '.dts': 'audio/vnd.dts',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff',
  '.amr': 'audio/amr',
  '.ape': 'audio/x-ape',
  '.wv': 'audio/x-wavpack',
  '.au': 'audio/basic',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.jfif': 'image/jpeg',
  '.webp': 'image/webp',
  // Decoded to PNG before they ever reach the renderer (imageDecode.ts).
  ...Object.fromEntries(decodableImages().map((e) => [e, 'image/png'])),
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf'
}
const mimeFor = (p: string): string => MIME[extname(p).toLowerCase()] ?? 'application/octet-stream'

// HEIC/HEIF stills are not decodable by Chromium, so we transcode them to JPEG in
// the main process (pure-JS libheif, no native binary) and serve that instead. A
// small cache keeps us from re-decoding on every request (preloads + the renderer
// image cache both hit this). Keyed by path + mtime so an edited file re-decodes.
const HEIC_EXTS = new Set(['.heic', '.heif'])
const heicCache = new Map<string, Buffer>()
const HEIC_CACHE_MAX = 6

// The decode itself happens in a utility process (see heicWorker.ts). Measured: a
// 3MB iPhone HEIC takes ~2s, and doing that inline froze the entire window, since
// the main process owns the window message loop on Windows.
let heicProc: Electron.UtilityProcess | null = null
let heicSeq = 0
const heicPending = new Map<number, { resolve: (b: Buffer) => void; reject: (e: Error) => void }>()

function heicWorker(): Electron.UtilityProcess {
  if (heicProc) return heicProc
  const proc = utilityProcess.fork(join(__dirname, 'heicWorker.js'))
  proc.on('message', (m: { id: number; ok: boolean; data?: Uint8Array; error?: string }) => {
    const p = heicPending.get(m.id)
    if (!p) return
    heicPending.delete(m.id)
    if (m.ok && m.data) p.resolve(Buffer.from(m.data))
    else p.reject(new Error(m.error ?? 'heic decode failed'))
  })
  proc.on('exit', () => {
    heicProc = null
    for (const p of heicPending.values()) p.reject(new Error('heic worker exited'))
    heicPending.clear()
  })
  heicProc = proc
  return proc
}

/**
 * The worker is kept alive between decodes (a fork costs more than most
 * decodes) but not FOREVER: a folder of photos browsed once used to leave a
 * node process resident for as long as Prism was, which for a resident app is
 * for as long as the machine is on (2026-08-28).
 */
const HEIC_IDLE_MS = 60_000
let heicIdle: NodeJS.Timeout | null = null

function heicKeepWarm(): void {
  if (heicIdle) clearTimeout(heicIdle)
  heicIdle = setTimeout(() => {
    heicIdle = null
    if (heicPending.size) return heicKeepWarm() // still busy; ask again later
    heicProc?.kill()
    heicProc = null
  }, HEIC_IDLE_MS)
}

async function heicToJpeg(filePath: string, mtimeMs: number): Promise<Buffer> {
  const key = `${filePath}|${mtimeMs}`
  const hit = heicCache.get(key)
  if (hit) {
    heicCache.delete(key)
    heicCache.set(key, hit) // LRU touch
    return hit
  }
  const id = ++heicSeq
  let buf: Buffer
  try {
    buf = await new Promise<Buffer>((resolve, reject) => {
      heicPending.set(id, { resolve, reject })
      heicWorker().postMessage({ id, path: filePath })
    })
  } finally {
    // In a finally, not on the happy path: a HEIC that fails to decode used to
    // leave the worker resident for the life of the app (2026-08-28).
    heicKeepWarm()
  }
  heicCache.set(key, buf)
  if (heicCache.size > HEIC_CACHE_MAX) {
    const oldest = heicCache.keys().next().value
    if (oldest) heicCache.delete(oldest)
  }
  return buf
}

// Serve a local file honouring Range requests (206), so media can seek. Mirrors
/**
 * Files main built itself and handed to the renderer as a media url: the
 * converted copy of a video, the wav a MIDI score was rendered to. They live
 * in userData, outside every root, so the wall below has to know about them.
 */
const servable = new Set<string>()

/** Native dialogs are OWNED by the window (2026-08-28). Unparented, Windows
 *  makes them modeless: a click on Prism buries the picker, and in fullscreen
 *  it never shows at all, which reads as the app hanging. Before there is a
 *  window there is nothing to own them, so those keep the old shape. */
function openDialog(opts: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
  return mainWindow ? dialog.showOpenDialog(mainWindow, opts) : dialog.showOpenDialog(opts)
}

/** The same, for saving. Parented for the same reason: an unparented dialog is
 *  modeless, and a fullscreen picker never shows at all. */
function saveDialog(opts: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> {
  return mainWindow ? dialog.showSaveDialog(mainWindow, opts) : dialog.showSaveDialog(opts)
}

/** Media may only be served from a root, from an archive member main extracted
 *  on request, or from something main made itself (2026-08-28). The fsaudio://
 *  sibling has always been walled; this one was not, which was an accident of
 *  the two handlers being written a month apart rather than a decision. */
/** Where the renderer's own files live. pdf.js fetches its cmaps, standard
 *  fonts, wasm and icc profiles through fsmedia:// (fetch refuses file: URLs
 *  in a packaged build), so the app's OWN asset tree has to be servable - and
 *  the wall refused it, which broke every PDF that does not embed its fonts.
 *  Invisible in dev, where the same data comes over the vite server. */
const RENDERER_DIR = resolve(join(__dirname, '..', 'renderer'))

/** Where comic books are unpacked. Granted as a DIRECTORY (2026-08-31): a
 *  200-page book would otherwise put 200 entries into `extractedPaths`, which
 *  is a Set that never shrinks and doubles as the wall's allowlist - and
 *  evicting a page's file without evicting its grant leaves a permission for
 *  a file that is gone. One directory, one rule, nothing to keep in step. */
let comicsDir = ''

function underDir(dir: string, p: string): boolean {
  const rel = relative(dir.toLowerCase(), resolve(p).toLowerCase())
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
}

function mediaAllowed(p: string): boolean {
  return (
    insideAnyRoot(p) ||
    extractedPaths.has(p) ||
    servable.has(p) ||
    underDir(RENDERER_DIR, p) ||
    (!!comicsDir && underDir(comicsDir, p))
  )
}

// Filesmith's serveMedia; becomes part of prism-core in Phase 1.
async function serveMedia(request: Request): Promise<Response> {
  let filePath: string
  try {
    filePath = decodeURIComponent(new URL(request.url).pathname).slice(1)
  } catch {
    return new Response(null, { status: 400 })
  }
  if (!mediaAllowed(filePath)) return new Response(null, { status: 403 })
  let st: ReturnType<typeof statSync>
  try {
    st = statSync(filePath)
  } catch {
    return new Response(null, { status: 404 })
  }

  const ext = extname(filePath).toLowerCase()
  // Camera raw: the full-size JPEG the camera embedded, which is what every
  // fast viewer shows. Developing the sensor data is another program's job.
  if (isRaw(filePath)) {
    try {
      const jpeg = await rawPreview(filePath, st.mtimeMs)
      return new Response(jpeg, {
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Length': String(jpeg.length),
          'Access-Control-Allow-Origin': '*'
        }
      })
    } catch {
      return new Response(null, { status: 415 }) // no preview inside it
    }
  }
  // Stills Chromium cannot draw (Targa, PCX, Photoshop, OpenEXR, DDS...) come
  // back as PNG from the bundled ffmpeg.
  if (needsImageDecode(filePath)) {
    const tools = findFfmpeg(app.isPackaged, process.resourcesPath, app.getAppPath())
    if (tools) {
      try {
        const png = await decodeImage(tools.ffmpeg, filePath, st.mtimeMs)
        // A multi-page TIFF shows its first page and nothing said so. ffmpeg
        // cannot reach page 2 at all, so this is a hint rather than a picker -
        // scans and faxes arrive this way constantly, and silence there is
        // how someone misses eleven pages of a document.
        const pages = /\.tiff?$/i.test(filePath) ? await tiffPages(filePath) : 1
        return new Response(png, {
          status: 200,
          headers: {
            'Content-Type': 'image/png',
            'Content-Length': String(png.length),
            'Access-Control-Allow-Origin': '*',
            // fsmedia:// is a different origin from the renderer, so without
            // the expose header res.headers.get() reads null and the hint
            // silently never appears.
            ...(pages > 1
              ? {
                  'X-Prism-Pages': String(pages),
                  'Access-Control-Expose-Headers': 'X-Prism-Pages'
                }
              : {})
          }
        })
      } catch {
        return new Response(null, { status: 415 }) // a still even ffmpeg refused
      }
    }
  }
  if (HEIC_EXTS.has(ext)) {
    try {
      const jpeg = await heicToJpeg(filePath, st.mtimeMs)
      return new Response(jpeg, {
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Length': String(jpeg.length),
          'Access-Control-Allow-Origin': '*'
        }
      })
    } catch {
      return new Response(null, { status: 415 }) // couldn't decode this HEIC
    }
  }

  const size = st.size
  const type = mimeFor(filePath)

  // Small images are consumed whole by the renderer and never issue Range requests,
  // so hand back one buffer instead of a stream — measured, the stream plumbing (not
  // the decode) dominated their load time. The cap is deliberately low: a single
  // large buffer crosses the process boundary as one IPC message, and tracing a
  // 40 MB image showed a 1.2s "Receive mojo message" stall in the renderer. Bigger
  // files stream, arriving in chunks that never block.
  if (type.startsWith('image/') && size <= 8 * 1024 * 1024) {
    try {
      const buf = await readFile(filePath)
      return new Response(buf, {
        status: 200,
        headers: {
          'Content-Type': type,
          'Content-Length': String(buf.length),
          'Access-Control-Allow-Origin': '*'
        }
      })
    } catch {
      return new Response(null, { status: 404 })
    }
  }
  const open = (opts?: { start: number; end: number }): NodeJS.ReadableStream => {
    const s = createReadStream(filePath, opts)
    s.on('error', () => s.destroy())
    return s
  }
  const body = (s: NodeJS.ReadableStream): ReadableStream =>
    Readable.toWeb(s as Readable) as unknown as ReadableStream

  const range = request.headers.get('range')
  const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null
  if (m) {
    let start = m[1] ? parseInt(m[1], 10) : 0
    let end = m[2] ? parseInt(m[2], 10) : size - 1
    if (!Number.isFinite(start) || start < 0) start = 0
    if (!Number.isFinite(end) || end >= size) end = size - 1
    if (start > end) start = end
    return new Response(body(open({ start, end })), {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*'
      }
    })
  }
  return new Response(body(open()), {
    status: 200,
    headers: {
      'Content-Type': type,
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*'
    }
  })
}

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
  if (!existsSync(p)) return null
  const dir = dirname(p)
  if (root === undefined) addRoot(dir)
  const here = root ?? dir
  const files = (await listDir(dir)).files
  const idx = files.findIndex((v) => resolve(v.path) === resolve(p))
  // An opened file the tree wouldn't list (an unknown extension) still shows,
  // alone: you asked for this file, so you get it.
  if (idx < 0) return { files: [await toViewerFile(p)], index: 0, root: here }
  return { files, index: idx, root: here }
}

/** Build the open payload for a FOLDER the user chose: the tree roots there and
 *  the viewer shows its first viewable file. A folder holding nothing Prism can
 *  show still opens - you get its tree and an empty viewer, which is a usable
 *  place to browse from rather than a refusal. */
async function folderPayload(dir: string): Promise<OpenPayload | null> {
  if (!existsSync(dir)) return null
  addRoot(dir)
  const files = (await listDir(dir)).files
  return { files, index: files.length ? 0 : -1, root: dir }
}

let mainWindow: BrowserWindow | null = null
let pendingOpen: Array<{ path: string; dir: boolean }> = []
/** Subtitle files the user chose in the dialog: reading those is allowed
 *  wherever they live, because choosing them in main's own dialog is the
 *  consent the root wall exists to ask for. */
const pickedSubs = new Set<string>()

/** The renderer's editor holds unsaved text. Mirrored here so `close` can ask. */
let editorDirty = false
/** The user has answered the "unsaved changes" question: let the close through. */
let closeConfirmed = false

async function sendOpen(target: { path: string; dir: boolean }): Promise<void> {
  // Came from outside: it becomes the root. A folder roots there and tells the
  // renderer so, which is what lets the "New tabs show" setting decide whether
  // that lands on the first file, a terminal, or nothing.
  const built = target.dir ? await folderPayload(target.path) : await buildPayload(target.path)
  const payload = target.dir && built ? { ...built, folder: true as const } : built
  if (payload && mainWindow) mainWindow.webContents.send('open:file', payload)
}

const TABS_STATE = (): string => join(app.getPath('userData'), 'tabs.json')

/**
 * The newest Claude session recorded for `root`, from claude's own store:
 * ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl. The encoding is
 * claude's (every non-alphanumeric character becomes a dash). Null when the
 * folder has no sessions - then nothing is resumed.
 */
/** Is `p` the folder `root` or inside it? Restore uses this to keep a saved
 *  root rather than letting the file's own folder become one. */
function insideRootPath(root: string, p: string): boolean {
  const a = resolve(root).toLowerCase()
  const b = resolve(p).toLowerCase()
  return b === a || b.startsWith(a.endsWith(sep) ? a : a + sep)
}

/** The marker that means "codex, continue this folder's newest session". Not
 *  an id: codex finds it itself. */
const CODEX_RESUME = 'codex:last'

function claudeSessions(root: string): string[] {
  const enc = root.replace(/[^A-Za-z0-9]/g, '-')
  const dir = join(app.getPath('home'), '.claude', 'projects', enc)
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ id: f.slice(0, -'.jsonl'.length), m: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m)
      .map((s) => s.id)
  } catch {
    return []
  }
}

/** Restore last session's strip: register each surviving root so the wall
 *  accepts it, then hand the renderer the payloads to rebuild the tabs from. */
async function restoreTabs(): Promise<OpenPayload[]> {
  const saved = readTabs(TABS_STATE())
  const out: OpenPayload[] = []
  // Two tabs on the SAME root can each hold their own claude conversation;
  // they take the folder's sessions newest-first, one each, never the same
  // one twice. (Which conversation belonged to which tab is unknowable after
  // the fact - newest-first in strip order is the honest guess.)
  const taken = new Map<string, number>()
  for (const [i, t] of saved.tabs.entries()) {
    // The SAVED root, not the file's folder: navigating into a subfolder and
    // reopening there used to leave the tab rooted at the subfolder, because
    // the payload was rebuilt from the file alone and root followed it. The
    // wall has to be registered here, since buildPayload only does that when
    // it is inventing the root itself.
    const keptRoot =
      t.file && existsSync(t.root) && insideRootPath(t.root, t.file) ? t.root : undefined
    if (keptRoot) addRoot(keptRoot)
    const payload = t.file ? await buildPayload(t.file, keptRoot) : await folderPayload(t.root)
    if (payload) {
      // A claude session resumes by ID - a session claude itself recorded for
      // this folder. No session on disk means no resume at all: never a bare
      // `--continue` guessing at a conversation.
      // Codex needs no lookup at all: `codex resume --last` continues the
      // most recent session FOR THIS FOLDER (its picker filters by cwd), so
      // the marker is enough and the shell starts in the tab's root anyway.
      let resume: string | null = null
      if (t.agent === 'codex' && t.term) resume = CODEX_RESUME
      else if (t.agent && t.term) {
        const key = t.root.toLowerCase()
        const n = taken.get(key) ?? 0
        resume = claudeSessions(t.root)[n] ?? null
        if (resume) taken.set(key, n + 1)
      }
      // SAVED order, exactly: the old active-goes-last splice scrambled the
      // strip. The active one carries a flag instead and the renderer brings
      // it to the front without moving it.
      out.push({
        ...payload,
        restore: true,
        ...(i === saved.active ? { restoreActive: true } : {}),
        ...(t.term ? { term: t.term } : {}),
        ...(resume ? { agentResume: resume } : {})
      })
    }
  }
  return out
}

/** Save on a delay, as the window state does: switching tabs with the arrow
 *  keys fires this continuously and the disk need not hear about each one. */
let tabsTimer: NodeJS.Timeout | null = null
let tabsPending: SavedTabs | null = null
function saveTabs(state: SavedTabs): void {
  tabsPending = state
  if (tabsTimer) clearTimeout(tabsTimer)
  tabsTimer = setTimeout(() => {
    tabsTimer = null
    if (tabsPending) writeTabs(TABS_STATE(), tabsPending)
  }, 400)
}

/** Close flushes the debounce: a report still in its 400ms window (an agent
 *  flag lands up to 2.5s after claude appears) must not die with the app -
 *  a lost last write is a Claude session that never resumes. */
function flushTabs(): void {
  if (tabsTimer) {
    clearTimeout(tabsTimer)
    tabsTimer = null
  }
  if (tabsPending) writeTabs(TABS_STATE(), tabsPending)
}

/**
 * Where the window was last time.
 *
 * Every launch opened at 1180x780 wherever Windows felt like putting it, so
 * anyone who wanted it bigger resized it again on every single file they opened.
 * The state is one small file in userData: size, position, and whether it was
 * maximised.
 *
 * It is checked against the displays actually attached before it is used. A
 * window remembered on a second monitor that is no longer there would otherwise
 * open somewhere nobody can reach it.
 */
interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  maximised?: boolean
}

const WINDOW_STATE = (): string => join(app.getPath('userData'), 'window-state.json')

function readWindowState(): WindowState {
  const fallback: WindowState = { width: 1180, height: 780 }
  try {
    const saved = JSON.parse(readFileSync(WINDOW_STATE(), 'utf8')) as WindowState
    if (!Number.isFinite(saved.width) || !Number.isFinite(saved.height)) return fallback
    const size = {
      width: Math.max(560, Math.round(saved.width)),
      height: Math.max(400, Math.round(saved.height)),
      maximised: saved.maximised === true
    }
    if (!Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return size
    // Only keep the position if some display still contains it: a window
    // remembered on a monitor that has since been unplugged opens off-screen.
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea
      return (
        saved.x! + size.width > a.x &&
        saved.x! < a.x + a.width &&
        saved.y! + size.height > a.y &&
        saved.y! < a.y + a.height
      )
    })
    return visible ? { ...size, x: Math.round(saved.x!), y: Math.round(saved.y!) } : size
  } catch {
    return fallback // no file yet, or one written by something else
  }
}

/** Save on a delay: a drag fires this continuously, and the disk does not need
 *  to hear about every pixel of it. */
function watchWindowState(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null
  const save = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      if (win.isDestroyed() || win.isMinimized()) return
      // getNormalBounds is the un-maximised size, which is what should come back
      // when the window is restored.
      const b = win.getNormalBounds()
      const state: WindowState = { ...b, maximised: win.isMaximized() }
      try {
        writeFileSync(WINDOW_STATE(), JSON.stringify(state))
      } catch {
        /* a viewer that cannot write its window size is still a viewer */
      }
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
    if (!editorDirty || closeConfirmed) return
    e.preventDefault()
    win.webContents.send('app:ask-close')
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

function applyMaterial(fullscreen: boolean): void {
  if (!mainWindow) return
  const { material, light } = wantedMaterial
  const solid = light ? '#f7f7f9' : '#111318'
  try {
    if (fullscreen || material === 'none') {
      mainWindow.setBackgroundColor(solid)
      mainWindow.setBackgroundMaterial('none')
    } else {
      mainWindow.setBackgroundColor('#00000000')
      mainWindow.setBackgroundMaterial(material as 'acrylic' | 'mica' | 'tabbed')
    }
  } catch {
    /* older Windows: the solid background stands */
  }
}

/**
 * The e2e's window never takes the foreground (2026-08-28).
 *
 * Electron has no headless mode, so the suite parks a real window offscreen -
 * but every launch still ACTIVATED it, and a suite that launches thirty times
 * yanked the caret out of whatever the machine's owner was typing. Playwright
 * drives the page over CDP, which needs no OS focus at all, so in this mode
 * the window is created unfocusable and shown inactive.
 */
const E2E = process.argv.includes('--e2e')

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
onRootsChanged((root, open) => {
  if (!open) {
    unwatchRoot(root)
    return
  }
  watchRoot(root, (change) => mainWindow?.webContents.send('dir:changed', change), isSkipped)
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

app.setAppUserModelId('com.prism.viewer')
if (!E2E) Menu.setApplicationMenu(null)
// The AES-zip path used to look for 7-Zip in Program Files and tell the user
// to install one, while Prism has been shipping it in resources/bin since
// 2026-08-24. Injected here so archive.ts stays electron-free and testable.
setSevenExe(bundledSeven(app.isPackaged, process.resourcesPath, app.getAppPath()))
// Set once rather than on first use: the media wall consults it, and a wall
// whose rule appears part way through a session is a rule nobody can reason
// about.
comicsDir = join(app.getPath('userData'), 'comics')

/**
 * "Open in Prism" is ON by default (2026-08-31, owner decision).
 *
 * Applied ONCE, and the marker file is the whole design. A default that
 * reapplied itself every launch would be a setting that lies: turn the verb
 * off in Settings and it would be back tomorrow, which is exactly the failure
 * the confirm-close setting's own rule warns about.
 *
 * Not in dev and not under --e2e. `app.getPath('exe')` is the built electron
 * binary in both, and writing HKCU keys pointing at it would repoint the real
 * installed Prism's verb at a throwaway build - thirty e2e launches doing that
 * is its own kind of broken.
 *
 * One wart, said rather than hidden: someone who deliberately turned the verb
 * off before this change has no record of having done so - the switch reads
 * the registry, not a preference - so they get it back once on upgrade, and
 * have to turn it off again.
 */
async function applyVerbDefault(): Promise<void> {
  if (!app.isPackaged || E2E) return
  const marker = join(app.getPath('userData'), 'shell-verb-applied')
  try {
    const fs = await import('fs/promises')
    if (await fs.stat(marker).catch(() => null)) return
    await installVerb(app.getPath('exe'))
    // After the attempt, whatever it answered: the fact recorded is "the
    // default has been applied", not "the write succeeded". A reg.exe that
    // fails every launch is worse than a verb that is missing.
    await fs.writeFile(marker, new Date().toISOString())
  } catch {
    /* no userData, no registry: the switch in Settings still works */
  }
}

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
function raise(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  win.show()
  if (E2E) return
  const wasOnTop = win.isAlwaysOnTop()
  win.setAlwaysOnTop(true)
  win.focus()
  win.setAlwaysOnTop(wasOnTop)
}

function createWindow(): void {
  const remembered = readWindowState()
  mainWindow = new BrowserWindow({
    width: remembered.width,
    height: remembered.height,
    x: remembered.x,
    y: remembered.y,
    minWidth: 560,
    minHeight: 400,
    show: false,
    ...(E2E ? { focusable: false, skipTaskbar: true } : {}),
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
        ...(process.argv.includes('--demo') ? ['--prism-demo'] : [])
      ]
    }
  })
  mainWindow.on('ready-to-show', () => {
    // Maximised is restored after the window exists rather than at construction:
    // a window created maximised has no sensible un-maximised size to go back to.
    if (remembered.maximised) mainWindow?.maximize()
    if (E2E) mainWindow?.showInactive()
    else if (mainWindow) raise(mainWindow)
  })
  watchWindowState(mainWindow)
  mainWindow.on('closed', () => (mainWindow = null))
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
    mainWindow?.webContents.send('window:state', {
      minimised: mainWindow.isMinimized(),
      focused: mainWindow.isFocused()
    })
  // Listed one by one: BrowserWindow's overloads are per event name, so a loop
  // over a union of them has no single signature to match.
  mainWindow.on('minimize', sayState)
  mainWindow.on('restore', sayState)
  mainWindow.on('show', sayState)
  mainWindow.on('hide', sayState)
  mainWindow.on('focus', sayState)
  mainWindow.on('blur', sayState)

  mainWindow.on('enter-full-screen', () => {
    mainWindow?.webContents.send('window:fullscreen', true)
    applyMaterial(true)
  })
  mainWindow.on('leave-full-screen', () => {
    mainWindow?.webContents.send('window:fullscreen', false)
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
  mainWindow.webContents.setWindowOpenHandler((d) => {
    if (/^https?:\/\//i.test(d.url)) void shell.openExternal(d.url)
    return { action: 'deny' }
  })
  // A page cannot navigate the window away from the app either: the renderer
  // is Prism's own UI and nothing in it is a browser.
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const dev = process.env['ELECTRON_RENDERER_URL']
    if (dev && url.startsWith(dev)) return
    if (url.startsWith('file://')) return
    e.preventDefault()
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void mainWindow.loadURL(devUrl)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))

  // Rebuild last session's strip, then deliver whatever the app was launched
  // with. Order matters: the launch file goes through the same arriving-file
  // rule as everything else, so double-clicking a photo in a folder that was
  // already open lands in that tab rather than opening a second copy of it.
  mainWindow.webContents.on('did-finish-load', () => {
    // SEQUENTIAL, and that is the whole point of the IIFE (2026-08-31). These
    // became async when listDir did, and firing them off together would let
    // the launch file race the restored tabs: the arriving-file rule folds a
    // file into a tab whose root already holds it, so a launch file that
    // arrives BEFORE its own restored tab spawns a duplicate instead.
    void (async () => {
      for (const payload of await restoreTabs()) mainWindow?.webContents.send('open:file', payload)
      // In argv order, each through the ordinary arriving-file route, so
      // several files from one folder still fold into ONE tab and the last
      // named ends up in front - the one a "prism a.jpg b.jpg" reader means.
      for (const t of pendingOpen) await sendOpen(t)
      pendingOpen = []
    })()
  })
}

// Single instance: a second launch (opening another file) forwards its path to
// the running window and focuses it, instead of spawning a rival process.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const paths = pathsFromArgv(argv)
    if (mainWindow) {
      // The handoff is the case the foreground lock bites hardest: Prism has
      // been sitting in the background for an hour, and the file it is handed
      // must arrive in a window that is actually in front of you.
      if (E2E) mainWindow.show()
      else raise(mainWindow)
      // Raised FIRST and unawaited, so the foreground-lock fix still runs the
      // instant the handoff arrives. The opens are sequential for the same
      // reason as the launch drain above: order is what folds them into one
      // tab and leaves the last-named file in front.
      void (async () => {
        for (const p of paths) await sendOpen(p)
      })()
    }
  })

  pendingOpen = pathsFromArgv(process.argv)

  // Every shell dies with the app; a pty with no window is an orphan.
  app.on('will-quit', () => {
    killAll()
    killSidecars()
    cancelAllConversions()
  })

  // Warm the terminal's fixed costs shortly after launch: the native module
  // import and the shell probe both belong off every later click path.
  app.whenReady().then(() =>
    setTimeout(() => {
      void import('node-pty')
      void detectShells()
    }, 2500)
  )

  app.whenReady().then(() => {
    protocol.handle(MEDIA_SCHEME, (request) => serveMedia(request))
    protocol.handle(AUDIO_SCHEME, (request) =>
      serveSidecarAudio(request, {
        allowed: (p) => insideAnyRoot(p) || extractedPaths.has(p),
        packaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        appPath: app.getAppPath()
      })
    )

    // The update check: watch GitHub Releases, remember the newest offer so a
    // renderer that loads after the tick still hears about it.
    let pendingUpdate: UpdateInfo | null = null
    watchForUpdates((info) => {
      pendingUpdate = info
      mainWindow?.webContents.send('update:available', info)
    })
    ipcMain.on('update:announce', (e) => {
      if (pendingUpdate) e.sender.send('update:available', pendingUpdate)
    })
    // Installing quits the app so NSIS can replace it. A dirty buffer VETOES
    // that quit (the close flow below), so without asking first the installer
    // would run over a live exe while a save dialog waited (2026-08-28). The
    // renderer answers Cancel / Discard / Save all before the download starts.
    ipcMain.handle('update:install', async (_e, url: string) => {
      if (typeof url !== 'string') return false
      // Unsaved text VETOES the quit this ends in (win.on('close') below), so
      // installing over it would run NSIS against a live exe while a dialog
      // waited (2026-08-28). The renderer settles the question first and this
      // refuses until it has; then the quit is pre-answered, like any other
      // route the user has already agreed to.
      if (editorDirty) return false
      closeConfirmed = true
      const ok = await installUpdate(url, (pct) =>
        mainWindow?.webContents.send('update:progress', pct)
      )
      // A download that FAILED must not leave the close question pre-answered
      // for the rest of the session: the next Alt+F4 over unsaved text would
      // close over the top of it without asking.
      if (!ok) closeConfirmed = false
      return ok
    })

    ipcMain.handle('open:dialog', async (): Promise<OpenPayload | null> => {
      const r = await openDialog({ properties: ['openFile'] })
      if (r.canceled || !r.filePaths.length) return null
      return buildPayload(r.filePaths[0])
    })
    // Choosing a folder rather than a file: the other way in, and the only one
    // that names the root deliberately instead of inferring it from a file.
    ipcMain.handle('open:folder', async (_e, from?: string): Promise<OpenPayload | null> => {
      // Open the browser where the tab already is: changing a tab's folder
      // almost always means a sibling or a child of the one it is on, and
      // starting at Documents made every one of those a walk.
      const at = typeof from === 'string' && existsSync(from) ? from : undefined
      const r = await openDialog({
        properties: ['openDirectory'],
        ...(at ? { defaultPath: at } : {})
      })
      if (r.canceled || !r.filePaths.length) return null
      return folderPayload(r.filePaths[0])
    })
    // A new tab, with nothing to answer first. The + is meant to be instant, so
    // it lands somewhere sensible - the user's own folder - and the sidebar's
    // folder button is where choosing happens.
    ipcMain.handle('open:home', (): Promise<OpenPayload | null> =>
      folderPayload(app.getPath('home'))
    )
    // The Settings "new tabs open in" folder: stored renderer-side, opened
    // here. folderPayload refuses a path that no longer exists, and the
    // renderer falls back to home when it does.
    ipcMain.handle('open:root', (_e, dir: string): Promise<OpenPayload | null> =>
      folderPayload(dir)
    )
    // Choose a folder WITHOUT opening it - the Settings picker.
    ipcMain.handle('dialog:pick-folder', async (): Promise<string | null> => {
      const r = await openDialog({ properties: ['openDirectory'] })
      return r.canceled || !r.filePaths.length ? null : r.filePaths[0]
    })
    /** Several real files at once: the archive panel's "Add files" verb. */
    ipcMain.handle('dialog:pick-files', async (): Promise<string[]> => {
      const r = await openDialog({ properties: ['openFile', 'multiSelections'] })
      return r.canceled ? [] : r.filePaths
    })
    ipcMain.handle('open:path', (_e, p: string): Promise<OpenPayload | null> => buildPayload(p))

    /**
     * Save the picture as an ordinary PNG or JPEG, somewhere the user picks.
     *
     * The destination is OUTSIDE every root on purpose, and that is not a hole
     * in the wall: main's own save dialog IS the consent, exactly as it is for
     * "Extract all" and for picking a subtitle file. The renderer hands over
     * bytes it encoded from the decoded picture; main never re-reads the
     * source, so a HEIC or a camera RAW saves as easily as a PNG.
     */
    ipcMain.handle(
      'image:save-copy',
      async (
        _e,
        bytes: ArrayBuffer,
        suggested: string,
        format: 'png' | 'jpeg'
      ): Promise<string | null> => {
        if (!(bytes instanceof ArrayBuffer) || !bytes.byteLength) return null
        const ext = format === 'png' ? 'png' : 'jpg'
        const r = await saveDialog({
          defaultPath: suggested.replace(/\.[^.]*$/, '') + '.' + ext,
          filters: [{ name: format === 'png' ? 'PNG image' : 'JPEG image', extensions: [ext] }]
        })
        if (r.canceled || !r.filePath) return null
        try {
          // Muted so the folder watcher does not report Prism's own write.
          ownWrite(r.filePath)
          await writeFile(r.filePath, Buffer.from(bytes))
          return r.filePath
        } catch {
          return null
        }
      }
    )
    /* ----- the terminal ----- */

    // Sessions are keyed by renderer-assigned ids, like tabs. The one check on
    // spawn: the shell STARTS in an open root (it may leave; that is a shell).
    ipcMain.handle('term:shells', () => detectShells())
    ipcMain.handle(
      'term:spawn',
      async (_e, id: string, root: string, shellId?: string, resume?: string) => {
        if (!insideAnyRoot(root) && !isAnyRoot(root)) return false
        // The resume id came from main's own scan of ~/.claude/projects, but it
        // crossed the renderer on the way back - shape-check it again before it
        // goes anywhere near a command line.
        const safeResume =
          resume === CODEX_RESUME || (resume && /^[0-9a-f][0-9a-f-]{6,62}[0-9a-f]$/i.test(resume))
            ? resume
            : undefined
        const ok = await spawnTerm(
          id,
          root,
          shellId,
          (ch, ...a) => mainWindow?.webContents.send(ch, ...a),
          safeResume
        )
        // Warm the agent-poll pipeline now: the first CIM query is the slow one
        // (cold WMI), and running it while the user is still typing their first
        // command means the dot can appear on the poll that actually matters.
        if (ok) setTimeout(pollAgents, 300)
        return ok
      }
    )
    ipcMain.on('term:input', (_e, id: string, d: string) => writeTerm(id, d))
    ipcMain.on('term:resize', (_e, id: string, c: number, r: number) => resizeTerm(id, c, r))
    ipcMain.on('term:kill', (_e, id: string) => killTerm(id))
    // The renderer says which root is in front and shell-less; main starts
    // its shell ahead of the click. Best-effort, walled like term:spawn.
    ipcMain.on('term:prewarm', (_e, root: string, shellId?: string) => {
      if (insideAnyRoot(root) || isAnyRoot(root)) void prewarmShell(root, shellId)
    })

    /**
     * The agent poll behind the tab dots (rewritten 2026-08-28).
     *
     * It used to spawn a PowerShell and dump EVERY process on the machine,
     * with command lines, into a 32MB buffer, every 2.5 seconds, for as long
     * as a terminal existed. That is a process launch and a megabyte or two of
     * JSON a few times a minute, forever, to answer a question whose answer
     * almost never changes.
     *
     * Three things fix it without giving up the feature:
     *
     *  - ASK ONLY WHEN SOMETHING COULD HAVE CHANGED. An agent cannot start or
     *    finish in a shell that has printed nothing, so a poll is skipped
     *    entirely unless a pty has produced output since the last look.
     *  - BACK OFF WHILE THE ANSWER HOLDS. Same answer twice, look half as
     *    often, up to 20s; a changed answer goes back to 2.5s.
     *  - CARRY LESS. The query returns plain "pid ppid" lines, with the
     *    command line only on rows a cheap prefilter matched. The strict
     *    decision stays in agentDetect, on the few rows that reach it.
     */
    const agentState = new Map<string, boolean>()
    let agentBusy = false
    let agentSeenTicks = -1
    let agentEvery = AGENT_POLL_MIN
    let agentNext = 0
    const pollAgents = (): void => {
      const pids = livePids()
      if (!pids.length || agentBusy) return
      const ticks = ptyOutputTicks()
      const quiet = ticks === agentSeenTicks
      const known = pids.every((s) => agentState.has(s.id))
      // A shell that has said nothing since the last look, whose answer we
      // already have, cannot have changed its mind.
      if (quiet && known) return
      // The backoff is for an answer that keeps coming back the same; a
      // session nobody has asked about yet has no answer to hold, so it is
      // not made to wait 20 seconds for its first one (2026-08-28).
      const now = Date.now()
      if (known && now < agentNext) return
      agentBusy = true
      execFile(
        'powershell.exe',
        ['-NoProfile', '-Command', AGENT_QUERY],
        { windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
        (err, stdout) => {
          agentBusy = false
          // Only a query that actually answered counts as having looked: a
          // failed one used to consume the activity tick, so a shell that then
          // fell quiet kept a stale dot until it printed again (2026-08-28).
          if (err || !stdout) return
          const rows = parseProcLines(stdout)
          if (!rows.length) return
          agentSeenTicks = ticks
          let changed = false
          for (const { id, pid } of livePids()) {
            const kind = treeAgentKind(rows, pid)
            const has = kind !== null
            if (agentState.get(id) !== has) {
              agentState.set(id, has)
              changed = true
              mainWindow?.webContents.send('term:agent', id, has, kind)
            }
          }
          // forget sessions that ended
          const live = new Set(livePids().map((s) => s.id))
          for (const id of [...agentState.keys()]) if (!live.has(id)) agentState.delete(id)
          agentEvery = changed ? AGENT_POLL_MIN : Math.min(AGENT_POLL_MAX, agentEvery * 2)
          agentNext = Date.now() + agentEvery
        }
      )
    }
    setInterval(pollAgents, AGENT_POLL_MIN)
    // The terminal's clickable links. http(s) only, checked on both sides.
    ipcMain.on('shell:open-external', (_e, url: string) => {
      if (/^https?:/i.test(url)) void shell.openExternal(url)
    })

    // The renderer owns the tab list; main persists it. The root wall is NOT
    // rebuilt from this snapshot: a report races payloads still in flight, and
    // replacing the set once tore out a root main had just registered for a
    // file the renderer had not seen yet - whose listDir was then refused and
    // cached as unreadable. Additions stay main's (the payload builders);
    // removals arrive explicitly below, and a snapshot cannot remove what it
    // never knew about.
    ipcMain.on('tabs:changed', (_e, state: SavedTabs) => saveTabs(state))
    // The renderer is the only thing that knows whether a media element is
    // actually playing, so it owns the answer and main just holds the block.
    ipcMain.on('power:awake', (_e, on: boolean) => keepAwake(on))
    // A root no longer held by ANY tab (closed, or rerooted away). Explicit,
    // one at a time, from the owner of the tab list.
    ipcMain.on('roots:drop', (_e, root: string) => {
      dropRoot(root)
      killWarm(root) // a warm spare for a closed tab is an orphan
    })
    // The three navigation handlers take the root they act in, because they are
    // per-tab operations and the renderer always knows which tab asked. Both the
    // root and the path have to hold up: naming a root you never opened gets you
    // nothing, and neither does a path from a DIFFERENT open root.
    //
    // A click in the sidebar tree. It leaves the root alone: the tree you
    // clicked from stays the tree you're in.
    ipcMain.handle(
      'open:within',
      async (_e, root: string, p: string): Promise<OpenPayload | null> =>
        validRoot(root, p) ? await buildPayload(p, root) : null
    )
    ipcMain.handle('dir:list', async (_e, root: string, p: string): Promise<DirListing | null> =>
      validRoot(root, p) ? await listDir(p) : null
    )
    // The sidebar's search: that tab's whole root, bounded, never outside it.
    ipcMain.handle('search:files', async (_e, root: string, query: string) =>
      validRoot(root, root) ? await searchFiles(root, query) : { hits: [], truncated: false }
    )
    // File operations. Inside the root only, and nothing is ever destroyed: an
    // overwritten or deleted file goes to the Recycle Bin.
    // The root itself is off limits: renaming or binning the folder the tree is
    // rooted in would pull the ground out from under the window.
    const editable = (p: string): boolean => insideAnyRoot(p) && !isAnyRoot(p)

    ipcMain.handle(
      'file:rename',
      async (_e, p: string, name: string, onClash: OnClash): Promise<RenameResult> => (
        ownWrite(p),
        editable(p)
          ? renameFile(p, name, onClash, (t) => shell.trashItem(t))
          : { ok: false, reason: 'failed', message: 'That folder is the one Prism opened in.' }
      )
    )
    ipcMain.handle('file:trash', async (_e, p: string): Promise<boolean> => {
      ownWrite(p)
      if (!editable(p)) return false
      try {
        await shell.trashItem(p)
        return true
      } catch {
        return false
      }
    })
    // The same wall as every other handler. A text file only ever reaches the
    // renderer from inside the session root, and opening one from outside
    // re-roots first, so this refuses nothing the app legitimately asks for.
    /**
     * The LAST slice of a file, read-only (2026-08-31).
     *
     * For a file `file:text` refuses: over 64MB it cannot be handed over as
     * one string, and the honest answer used to be an overlay saying so. The
     * tail is the useful half of a 900MB log. Answers with the offset and
     * the real size, so the editor can say what it is showing - and it never
     * pretends to be the file, so nothing can save it back.
     */
    ipcMain.handle('file:tailBytes', async (_e, p: string, max: number) => {
      if (typeof p !== 'string' || (!insideAnyRoot(p) && !extractedPaths.has(p))) return null
      const want = Math.min(Math.max(64 * 1024, Number(max) || 0), TEXT_MAX_BYTES)
      return readTail(p, want)
    })

    /** Follow a file that is still being written: new bytes arrive on
     *  `file:appended` until `tail:stop`. One watch per path. */
    ipcMain.handle('tail:start', async (_e, p: string, from: number) => {
      if (typeof p !== 'string' || (!insideAnyRoot(p) && !extractedPaths.has(p))) return false
      return startTail(p, Number(from) || 0, (e) =>
        mainWindow?.webContents.send('file:appended', e)
      )
    })
    ipcMain.handle('tail:stop', (_e, p: string) => {
      if (typeof p === 'string') stopTail(p)
    })

    ipcMain.handle('file:text', async (_e, p: string): Promise<TextRead> => {
      // Extracted archive members live in temp, outside every root; each one
      // was granted individually when archive:extract wrote it.
      if (!insideAnyRoot(p) && !extractedPaths.has(p)) return { error: 'unreadable' }
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
        // A markdown document may point at pictures OUTSIDE the folder Prism
        // opened in ("../assets/logo.png" from a doc in docs/), which the
        // media wall would otherwise refuse. Main grants exactly the files
        // this document names, having read it (see docImages.ts).
        if (isMarkdownPath(p)) for (const img of documentImages(p, text)) servable.add(img)
        return { text }
      } catch {
        return { error: 'unreadable' }
      }
    })
    // The editor's save. Text files only, in place, inside the root: this is
    // the third thing Prism writes (after rename and bin), and the narrowest.
    /**
     * Save the editor's text. Answers with a REASON (2026-08-30).
     *
     * It used to demand that the file already exist, and answer a bare
     * boolean. Both hurt: a file renamed or moved out from under a dirty
     * buffer could never be saved at all, and "Save all changes" at close
     * time failed with nothing to show the user but a silence. The parent
     * folder still has to exist, so a save cannot create a file somewhere
     * nothing asked for, and the root wall and the text-kind check are
     * unchanged. Extracted archive members stay unwritable: reads honour
     * `extractedPaths`, writes never do.
     */
    ipcMain.handle('file:write', async (_e, p: string, text: string): Promise<WriteResult> => {
      ownWrite(p)
      if (!insideAnyRoot(p)) return { ok: false, reason: 'refused' }
      if (fileKind(extname(p).toLowerCase(), basename(p)) !== 'text')
        return { ok: false, reason: 'refused' }
      if (!existsSync(dirname(p))) return { ok: false, reason: 'gone' }
      try {
        // Back in the shape it came in. CodeMirror rejoins its document with
        // a bare newline whatever it read, so without this one fixed typo in
        // a .bat was 400 changed lines, and a UTF-16 file came back as UTF-8.
        const shape = textShape.get(p.toLowerCase()) ?? {
          encoding: 'utf8' as const,
          eol: 'lf' as const
        }
        await writeFile(p, encodeText(text, shape))
        return { ok: true }
      } catch (e) {
        // EACCES, EROFS, ENOSPC: the cases worth naming rather than leaving
        // the user to guess why their work would not save.
        return {
          ok: false,
          reason: 'failed',
          message: String((e as NodeJS.ErrnoException)?.code ?? '')
        }
      }
    })

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
      if (typeof p !== 'string' || (!insideAnyRoot(p) && !extractedPaths.has(p))) return {}
      return photoInfo(p)
    })

    // What the Properties popup can't compute in the renderer: dates and the
    // authoritative size, straight from the file system. Root-guarded.
    ipcMain.handle(
      'file:stat',
      (_e, p: string): { size: number; mtimeMs: number; isFolder: boolean } | null => {
        if (!insideAnyRoot(p)) return null
        try {
          const st = statSync(p)
          return { size: st.size, mtimeMs: st.mtimeMs, isFolder: st.isDirectory() }
        } catch {
          return null
        }
      }
    )

    /* ----- subtitles ----- */

    // Sidecar tracks for a video (same name, same folder or Subs/), and their
    // text as WebVTT. Same wall as everything else: inside the root only.
    ipcMain.handle('subs:for', (_e, p: string): SubTrack[] =>
      insideAnyRoot(p) ? sidecarsFor(p) : []
    )
    /**
     * A subtitle file the user points at (2026-08-27), for the tracks the
     * name-matching cannot find: a differently named .srt, or one kept
     * somewhere else entirely.
     *
     * The dialog IS the consent, which is why the answer is remembered as
     * readable - it can sit outside every root, and the root wall would
     * otherwise refuse the file the user just chose.
     */
    ipcMain.handle('subs:pick', async (_e, near?: string): Promise<SubTrack | null> => {
      const r = await openDialog({
        properties: ['openFile'],
        ...(typeof near === 'string' && existsSync(dirname(near))
          ? { defaultPath: dirname(near) }
          : {}),
        filters: [{ name: 'Subtitles', extensions: ['srt', 'vtt', 'ass', 'ssa'] }]
      })
      if (r.canceled || !r.filePaths.length) return null
      const p = r.filePaths[0]
      pickedSubs.add(p)
      return { path: p, label: basename(p) }
    })
    ipcMain.handle('subs:read', async (_e, p: string): Promise<string | null> =>
      insideAnyRoot(p) || pickedSubs.has(p)
        ? readAsVtt(p, findFfmpeg(app.isPackaged, process.resourcesPath, app.getAppPath())?.ffmpeg)
        : null
    )

    /* ----- audio Chromium cannot decode ----- */

    const sidecarUrl = (p: string, stream: number, duration: number): string =>
      `${AUDIO_SCHEME}://track/${encodeURIComponent(p)}?s=${stream}&d=${duration}`

    // One probe per file, kept for as long as the file has not changed: the
    // audio player, the video player and the no-picture note all ask.
    const probeCache = new Map<string, MediaInfo | null>()

    // Ask before playing: what does this file hold, does its audio need Prism's
    // own decoder, and is there one? The renderer plays the answer's url beside
    // the video (which stays silent by itself, having no decoder for the track
    // either), or IN PLACE of the file for an audio-only viewer.
    /**
     * The waveform transport's envelope. Computed by ffmpeg here and streamed,
     * because the renderer's old way - fetch the file, decodeAudioData the lot
     * - took 7.4GB on a 2GB film and threw at the end of it.
     */
    ipcMain.handle('media:peaks', async (_e, p: string): Promise<number[] | null> => {
      if (typeof p !== 'string' || (!insideAnyRoot(p) && !extractedPaths.has(p))) return null
      // Known already: no ffprobe, no ffmpeg, no wait.
      const known = cachedPeaks(p)
      if (known) return known
      const tools = findFfmpeg(app.isPackaged, process.resourcesPath, app.getAppPath())
      if (!tools) return null
      if (!tools.ffprobe) return null
      const info = await probeMedia(tools.ffprobe, p)
      if (!info?.audio || !info.duration) return null
      return loadPeaks(tools.ffmpeg, p, info.duration)
    })
    ipcMain.handle('media:probe', async (_e, p: string): Promise<MediaProbe> => {
      const none: MediaProbe = { ffmpeg: false, needed: false }
      if (typeof p !== 'string' || (!insideAnyRoot(p) && !extractedPaths.has(p))) return none
      // A MIDI file is a score, not a recording: it has to be synthesised
      // before there is anything to play. The answer comes back at once so the
      // player can say so, and the rendering is asked for separately - loading
      // a 23MB soundfont takes a moment, and an <audio> pointed at the .mid
      // meanwhile would flash "can't be played".
      if (isMidi(p)) {
        const fluid = findFluid(app.isPackaged, process.resourcesPath, app.getAppPath())
        return { ffmpeg: !!fluid, needed: true, synth: true, codec: 'midi' }
      }
      const tools = findFfmpeg(app.isPackaged, process.resourcesPath, app.getAppPath())
      if (!tools) return none
      let key: string
      try {
        key = `${p}|${statSync(p).mtimeMs}`
      } catch {
        return none
      }
      let info = probeCache.get(key)
      if (info === undefined) {
        info = tools.ffprobe ? await probeMedia(tools.ffprobe, p) : null
        if (probeCache.size > 40) probeCache.clear()
        probeCache.set(key, info)
      }
      // No ffprobe, or a container it could not read: the renderer still has a
      // second way in (its decoder byte counter), so offer the first track
      // blind rather than nothing.
      if (!info) return { ffmpeg: true, needed: false, blind: true }
      const plan = planConversion(info, extname(p))
      // A converted copy carries its own sound, so the sidecar stands down.
      const needed = !plan.needed && needsSidecar(info.audio?.codec, extname(p))
      const base: MediaProbe = {
        ffmpeg: true,
        needed,
        videoCodec: info.videoCodec ?? undefined,
        fps: info.fps ?? undefined,
        convert: plan.needed ? { reason: plan.reason ?? 'codec', quick: plan.copyVideo } : undefined
      }
      // More than one track: offer them all, each with the url that plays it.
      // One track needs no picker, and a picker with one row is chrome.
      const tracks =
        info.duration > 0 && info.tracks.length > 1
          ? info.tracks.map((t) => ({
              index: t.index,
              codec: t.codec,
              channels: t.channels,
              language: t.language,
              title: t.title,
              url: sidecarUrl(p, t.index, info.duration)
            }))
          : undefined
      if (!info.audio || info.duration <= 0) return { ...base, blind: true, tracks }
      return {
        ...base,
        codec: info.audio.codec,
        channels: info.audio.channels,
        layout: info.audio.layout,
        url: sidecarUrl(p, info.audio.index, info.duration),
        tracks
      }
    })

    // Render a score. Separate from the probe because it can take seconds:
    // the player shows that it is working rather than an error.
    ipcMain.handle('audio:synth', async (_e, p: string): Promise<string | null> => {
      if (typeof p !== 'string' || (!insideAnyRoot(p) && !extractedPaths.has(p))) return null
      const fluid = findFluid(app.isPackaged, process.resourcesPath, app.getAppPath())
      if (!fluid || !isMidi(p)) return null
      try {
        const wav = await renderMidi(fluid, p, join(app.getPath('userData'), 'converted'))
        extractedPaths.add(wav)
        servable.add(wav)
        return `${MEDIA_SCHEME}://local/${encodeURIComponent(wav)}`
      } catch {
        return null
      }
    })

    // The blind route: the renderer watched its own decoder produce no audio
    // and knows the duration the element reported, so it can ask for the first
    // audio track without anything having probed the file.
    ipcMain.handle('audio:blind', (_e, p: string, duration: number): string | null => {
      if (typeof p !== 'string' || (!insideAnyRoot(p) && !extractedPaths.has(p))) return null
      if (!Number.isFinite(duration) || duration <= 0) return null
      if (!findFfmpeg(app.isPackaged, process.resourcesPath, app.getAppPath())) return null
      return sidecarUrl(p, FIRST_AUDIO, duration)
    })

    // Video Chromium cannot show: convert it once, then play the copy. The
    // renderer waits on this and shows progress; a file already converted
    // comes back immediately.
    const convertDir = (): string => join(app.getPath('userData'), 'converted')
    /** Source file -> the copy being written for it and how many viewers are
     *  waiting. Two tabs can hold the same film (each tab keeps its own live
     *  player), and they share ONE conversion: the first to walk away must not
     *  cancel it out from under the other (2026-08-28). */
    const converting = new Map<string, { out: string; viewers: number }>()
    ipcMain.handle(
      'video:convert',
      async (e, p: string): Promise<{ url?: string; error?: string }> => {
        if (typeof p !== 'string' || (!insideAnyRoot(p) && !extractedPaths.has(p)))
          return { error: 'outside the folder' }
        const tools = findFfmpeg(app.isPackaged, process.resourcesPath, app.getAppPath())
        if (!tools?.ffprobe) return { error: 'no decoder available' }
        const info = await probeMedia(tools.ffprobe, p)
        const plan = planConversion(info, extname(p))
        if (!plan.needed) return { error: 'nothing to convert' }
        try {
          const handle = convertVideo(
            tools.ffmpeg,
            p,
            convertDir(),
            plan,
            info?.duration ?? 0,
            (pct) => e.sender.send('video:progress', { path: p, pct })
          )
          // The renderer knows the FILE it asked about, never the copy's name,
          // so cancelling has to be answerable from the source (2026-08-28).
          const seen = converting.get(p)
          converting.set(p, { out: handle.out, viewers: (seen?.viewers ?? 0) + 1 })
          const out = await handle.done
          converting.delete(p)
          extractedPaths.add(out) // the copy is ours to serve, wherever it sits
          servable.add(out)
          return { url: `${MEDIA_SCHEME}://local/${encodeURIComponent(out)}` }
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'conversion failed' }
        }
      }
    )
    // Nobody is waiting for this any more: the viewer moved on to another
    // file while a whole film was being re-encoded behind it (2026-08-28).
    ipcMain.on('video:cancel', (_e, source: string) => {
      if (typeof source !== 'string') return
      const job = converting.get(source)
      if (!job) return
      job.viewers -= 1
      if (job.viewers > 0) return // somebody else is still waiting for it
      converting.delete(source)
      cancelConversion(job.out)
    })

    // Office and ebook documents: converted to HTML in main, sanitised there
    // too, so nobody else's markup reaches a renderer that can see window.prism.
    ipcMain.handle('doc:html', async (_e, p: string): Promise<string | null> => {
      if (typeof p !== 'string' || (!insideAnyRoot(p) && !extractedPaths.has(p))) return null
      if (!docKind(extname(p))) return null
      try {
        const html = await convertDoc(p)
        return html === null ? null : await sanitizeDoc(html)
      } catch {
        return null
      }
    })

    // "Open in Prism" in File Explorer's own context menu (HKCU only).
    ipcMain.handle('shell:verb-status', () => verbInstalled(app.getPath('exe')))
    ipcMain.handle('shell:verb-set', async (_e, on: boolean): Promise<boolean> => {
      if (typeof on !== 'boolean') return false
      return on ? installVerb(app.getPath('exe')) : removeVerb()
    })

    /* ----- context-menu verbs ----- */

    ipcMain.on('file:show-in-explorer', (_e, p: string) => {
      if (insideAnyRoot(p)) shell.showItemInFolder(p)
    })
    ipcMain.on('file:open-default', (_e, p: string) => {
      if (insideAnyRoot(p)) void shell.openPath(p)
    })
    // The Windows "how do you want to open this?" chooser, which also reaches
    // the store apps the submenu can't launch.
    ipcMain.on('file:open-chooser', (_e, p: string) => {
      if (!insideAnyRoot(p)) return
      spawn('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', p], {
        detached: true,
        stdio: 'ignore'
      }).unref()
    })

    // What the "Open in" submenu lists. The candidates main enumerated are the
    // only executables the launch handler below will ever run. Entries expire:
    // Prism is resident, and a list cached forever would never learn about a
    // newly installed app (or unlearn a transient reg.exe failure).
    const OPEN_WITH_TTL = 30_000
    const openWithCache = new Map<string, { list: AppCandidate[]; at: number }>()
    const cachedApps = (ext: string): AppCandidate[] | null => {
      const hit = openWithCache.get(ext)
      return hit && Date.now() - hit.at < OPEN_WITH_TTL ? hit.list : null
    }
    ipcMain.handle('apps:for', async (_e, p: string): Promise<OpenWithApp[]> => {
      if (!insideAnyRoot(p)) return []
      const ext = extname(p).toLowerCase()
      if (!ext) return []
      let list = cachedApps(ext)
      if (!list) {
        list = await appsForExt(ext)
        openWithCache.set(ext, { list, at: Date.now() })
      }
      return Promise.all(
        list.map(async (c) => ({
          id: c.exe,
          name: c.name,
          icon: await app
            .getFileIcon(c.exe, { size: 'small' })
            .then((i) => i.toDataURL())
            .catch(() => undefined)
        }))
      )
    })
    ipcMain.handle('file:open-with', (_e, p: string, exe: string): boolean => {
      if (!insideAnyRoot(p)) return false
      // The expired list still answers a launch: the menu the user is clicking
      // was built from it moments ago.
      const c = openWithCache.get(extname(p).toLowerCase())?.list.find((x) => x.exe === exe)
      if (!c) return false
      try {
        spawn(c.exe, argsFor(c.args, p), { detached: true, stdio: 'ignore' }).unref()
        return true
      } catch {
        return false
      }
    })

    // The real file onto the clipboard (a drop list, so Ctrl+V in Explorer
    // pastes it). Electron's clipboard has no CF_HDROP; PowerShell does.
    // One path or a multi-selection's worth: every one must pass the wall
    // (roots, or an individually granted extracted member) or nothing copies.
    ipcMain.handle('file:copy-clip', (_e, p: string | string[]): Promise<boolean> => {
      const list = Array.isArray(p) ? p : [p]
      if (
        !list.length ||
        list.some((x) => typeof x !== 'string' || (!insideAnyRoot(x) && !extractedPaths.has(x)))
      )
        return Promise.resolve(false)
      const quoted = list.map((x) => `'${x.replace(/'/g, "''")}'`).join(',')
      return new Promise((done) => {
        execFile(
          'powershell.exe',
          ['-NoProfile', '-Command', `Set-Clipboard -LiteralPath ${quoted}`],
          { windowsHide: true, timeout: 5000 },
          (err) => done(!err)
        )
      })
    })

    /**
     * The files on the clipboard, if any (2026-08-31).
     *
     * Through PowerShell, symmetrically with the copy above: Windows puts a
     * multi-file copy on the clipboard as CF_HDROP, which Electron's own
     * clipboard API does not expose - `readBuffer('FileNameW')` gives one
     * path and nothing else. `Get-Clipboard -Format FileDropList` gives the
     * list, and the copy side is already a PowerShell call for the same
     * reason.
     */
    function clipboardFiles(): Promise<string[]> {
      return new Promise((done) => {
        execFile(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            '(Get-Clipboard -Format FileDropList) | ForEach-Object { $_.FullName }'
          ],
          { windowsHide: true, timeout: 5000, encoding: 'utf8' },
          (err, out) =>
            done(
              err
                ? []
                : String(out ?? '')
                    .split(/\r?\n/)
                    .map((l) => l.trim())
                    .filter(Boolean)
            )
        )
      })
    }

    /**
     * Paste whatever is on the clipboard into a folder.
     *
     * The SOURCES may be anywhere - that is the point, you copied them in
     * Explorer - but the DESTINATION has to be inside a root, which is the
     * wall doing its job. Names never collide: `uniqueName` picks "name (2)"
     * the way Duplicate does, so a paste can add to a folder but never write
     * over what is in it.
     */
    ipcMain.handle('file:paste-into', async (_e, destDir: string) => {
      if (typeof destDir !== 'string' || !insideAnyRoot(destDir)) {
        return { pasted: 0, failed: 0, refused: true }
      }
      const src = await clipboardFiles()
      if (!src.length) return { pasted: 0, failed: 0, empty: true }
      ownWrite(join(destDir, 'x'))
      const fs = await import('fs/promises')
      let pasted = 0
      let failed = 0
      for (const s of src) {
        try {
          const target = join(destDir, uniqueName(destDir, basename(s)))
          // AWAITED and recursive: a folder travels whole, and cpSync on main's
          // one thread would freeze every window for as long as it took.
          await fs.cp(s, target, { recursive: true, errorOnExist: true, force: false })
          pasted += 1
        } catch {
          failed += 1
        }
      }
      return { pasted, failed }
    })

    // The icon Windows itself shows for a file of this type - the user's own
    // association (WinRAR, 7-Zip, Explorer's zip folder...). One fetch per
    // extension; the tree shows it for archives (#68, revised 2026-08-22).
    const extIconCache = new Map<string, string | null>()
    ipcMain.handle('icon:for-ext', async (_e, p: string): Promise<string | null> => {
      if (typeof p !== 'string' || !insideAnyRoot(p)) return null
      const ext = extname(p).toLowerCase()
      if (!ext) return null
      const hit = extIconCache.get(ext)
      if (hit !== undefined) return hit
      try {
        const img = await app.getFileIcon(p, { size: 'normal' })
        const url = img.isEmpty() ? null : img.toDataURL()
        extIconCache.set(ext, url)
        return url
      } catch {
        extIconCache.set(ext, null)
        return null
      }
    })

    // Undo's half of a delete: ask the shell for the items back. MoveHere
    // rather than InvokeVerb, because the Restore verb's NAME is localised
    // and the namespace move is not. Best effort: an item the user has since
    // emptied simply is not there any more.
    ipcMain.handle('file:restore', (_e, paths: string[]): Promise<boolean> => {
      ownWrite(...(Array.isArray(paths) ? paths : []))
      if (!Array.isArray(paths) || !paths.length || !paths.every((p) => insideAnyRoot(p)))
        return Promise.resolve(false)
      const list = paths.map((p) => `'${p.replace(/'/g, "''")}'`).join(',')
      const script = [
        '$ErrorActionPreference = "SilentlyContinue"',
        '$missing = $false',
        '$sh = New-Object -ComObject Shell.Application',
        '$bin = $sh.Namespace(0xA)',
        `foreach ($p in @(${list})) {`,
        '  $dir = Split-Path $p -Parent; $name = Split-Path $p -Leaf',
        '  $item = @($bin.Items() | Where-Object {',
        '    $_.Name -eq $name -and $_.ExtendedProperty("System.Recycle.DeletedFrom") -eq $dir',
        '  })[-1]',
        '  if ($item) { $sh.Namespace($dir).MoveHere($item) } else { $missing = $true }',
        '}',
        // Nothing came back: say so, or undo would claim a restore that never
        // happened (an emptied Recycle Bin is the common case).
        'if ($missing) { exit 1 }'
      ].join('; ')
      return new Promise((done) => {
        execFile(
          'powershell.exe',
          ['-NoProfile', '-Command', script],
          { windowsHide: true, timeout: 20000 },
          (err) => done(!err)
        )
      })
    })

    /* ----- drag and drop (#70): move, add to a zip, extract out of one ----- */

    // Every path, source and destination alike, must sit inside an open root:
    // dragging is not a way out of the wall. Extracted archive members are
    // granted individually, so a member dragged to a folder can be written.
    // A folder that is ITSELF a tab's root cannot be moved or zipped away:
    // the wall would be left pointing at nothing and that tab dies. Renaming
    // and binning a root are already refused; this is the same rule.
    const movable = (p: unknown): p is string =>
      typeof p === 'string' && !isAnyRoot(p) && (insideAnyRoot(p) || extractedPaths.has(p))
    ipcMain.handle(
      'file:move',
      async (_e, paths: string[], destDir: string, onClash: 'ask' | 'keep-both' | 'replace') => {
        // Both ends: a move empties one folder and fills another.
        ownWrite(destDir + sep + 'x', ...(Array.isArray(paths) ? paths : []))
        /**
         * A drop that asks for nothing does nothing, SILENTLY (2026-08-31).
         *
         * Picking a folder up and putting it back down where it was is how
         * anybody changes their mind mid-drag, and it was answering with "a
         * tab's own folder cannot be moved" - the wall talking about a move
         * nobody requested. Filtered out BEFORE the wall check, so the
         * gesture is a no-op rather than a refusal.
         */
        const wanted = (Array.isArray(paths) ? paths : []).filter(
          (p) =>
            typeof p === 'string' &&
            !insideSelf(p, destDir) &&
            resolve(dirname(p)).toLowerCase() !== resolve(destDir).toLowerCase()
        )
        if (!wanted.length) return { moved: [], clashes: [], failed: [], replaced: [] }
        if (!wanted.every(movable) || !insideAnyRoot(destDir))
          // `refused` is the wall talking, which is a different sentence from
          // "that file is locked": the renderer branches on it.
          return {
            moved: [],
            clashes: [],
            failed: wanted,
            replaced: [],
            refused: true
          }
        return moveEntries(wanted, destDir, onClash === 'ask' ? 'ask' : onClash, (t) =>
          shell.trashItem(t)
        )
      }
    )
    ipcMain.handle(
      'archive:add',
      (_e, zip: string, srcPaths: string[], destFolder: string, keepBoth?: boolean) => {
        if (!archiveOk(zip) || !Array.isArray(srcPaths) || !srcPaths.every(movable)) return 'failed'
        if (archiveTooLarge(statSync(zip).size)) return 'failed'
        return addToArchive(
          zip,
          srcPaths,
          typeof destFolder === 'string' ? destFolder : '',
          !!keepBoth
        )
      }
    )
    ipcMain.handle(
      'archive:move-members',
      (_e, zip: string, entries: string[], destFolder: string) => {
        if (!archiveOk(zip) || !Array.isArray(entries)) return 'failed'
        if (archiveTooLarge(statSync(zip).size)) return 'failed'
        return moveMembers(zip, entries, typeof destFolder === 'string' ? destFolder : '')
      }
    )
    ipcMain.handle(
      'archive:extract-to',
      (_e, zip: string, entries: string[], destDir: string, password?: string) => {
        if (!archiveOk(zip) || !Array.isArray(entries) || !insideAnyRoot(destDir))
          return { ok: false, reason: 'failed' }
        const pw = typeof password === 'string' ? password : ''
        // A .7z/.rar/.iso is not a zip: adm-zip cannot read one, so dragging a
        // member out of one always failed (2026-08-28).
        const exe = seven(zip)
        if (exe) return extractSevenTo(exe, zip, entries, destDir, pw)
        return extractTo(zip, entries, destDir, pw || undefined)
      }
    )

    /* ----- the archive verbs (#68): zip only, through src/main/archive.ts ----- */

    // Every verb names the zip, which must sit inside a root and actually be
    // an archive; the members have no independent existence on disk. Renames
    // and deletes rewrite the container, so an oversized archive is refused
    // rather than frozen over.
    const archiveOk = (p: unknown): p is string =>
      typeof p === 'string' && insideAnyRoot(p) && fileKind(extname(p)) === 'archive'
    /**
     * A comic book has its OWN guard, not `archiveOk` widened (2026-08-31).
     *
     * Widening that one would put Extract all, Add files and member Delete -
     * the one permanent delete in Prism - onto a comic. The whole reason
     * `.cbz` is not the archive kind is that its verbs are the wrong menu.
     */
    const comicOk = (p: unknown): p is string =>
      typeof p === 'string' && insideAnyRoot(p) && fileKind(extname(p)) === 'comic'

    ipcMain.handle('comic:open', async (_e, p: string, password?: string) => {
      if (!comicOk(p)) return { error: 'failed' as const }
      comicsDir = join(app.getPath('userData'), 'comics')
      const pw =
        typeof password === 'string' && password ? password : (archivePasswords.get(p) ?? '')
      const exe = bundledSeven(app.isPackaged, process.resourcesPath, app.getAppPath())
      if (!exe) return { error: 'failed' as const }
      const got = await openComic(exe, p, comicsDir, pw)
      if ('error' in got) return got
      if (pw) archivePasswords.set(p, pw)
      // No per-page grant: the pages live under `comicsDir`, which the media
      // wall allows as a directory.
      return { pages: got.pages }
    })
    /**
     * Which archives go through the bundled 7-Zip rather than adm-zip.
     *
     * 7z, rar, tar, gz and friends always do: they are READ-ONLY, since 7-Zip
     * lists and extracts them all and Prism never writes with it. zip keeps
     * its own in-process path, and its verbs.
     *
     * A .zip that is TOO BIG for adm-zip goes through 7-Zip as well
     * (2026-08-31). adm-zip reads the whole container into memory, which is
     * why anything over the cap was refused - but the cap is adm-zip's limit,
     * not zip's, and 7-Zip streams. A 1.9GB zip used to list (by reading 1.9GB
     * into main) and then answer "failed" to every extract, which is the worst
     * of both. Now it lists cheaply and extracts fine, and simply has no write
     * verbs, exactly like a .7z.
     */
    const seven = (p: string): string | null => {
      const exe = (): string | null =>
        bundledSeven(app.isPackaged, process.resourcesPath, app.getAppPath())
      if (isSevenArchive(extname(p))) return exe()
      try {
        return archiveTooLarge(statSync(p).size) ? exe() : null
      } catch {
        return null // gone between the listing and now
      }
    }

    /**
     * Extract-all's landing folder, and the ONE-FOLDER RULE (2026-08-31).
     *
     * An archive whose whole content is a single top-level folder - which is
     * what every "download as zip" produces - used to land as
     * `chosen/archive-name/TheFolder`, one level deeper than anybody wanted.
     * So after a successful extract, a wrapper holding exactly one directory
     * hands that directory up to its parent and removes itself.
     *
     * Done by MOVING rather than by extracting straight into the destination,
     * because the rule that Prism never writes over an existing folder is
     * worth more than the one rmdir it costs: the move picks "name (2)" the
     * same way the wrapper itself does, and a same-volume rename is instant
     * whatever the folder weighs.
     */
    async function unwrapSingleFolder(wrapper: string, parent: string): Promise<string> {
      try {
        const fs = await import('fs/promises')
        const kids = await fs.readdir(wrapper, { withFileTypes: true })
        if (kids.length !== 1 || !kids[0].isDirectory()) return wrapper
        let out = join(parent, kids[0].name)
        for (let n = 2; existsSync(out) && n < 100; n += 1)
          out = join(parent, `${kids[0].name} (${n})`)
        await fs.rename(join(wrapper, kids[0].name), out)
        await fs.rmdir(wrapper).catch(() => {})
        return out
      } catch {
        return wrapper
      }
    }

    /** Extract the whole archive into `into`, which must already exist. */
    async function extractWhole(
      p: string,
      into: string
    ): Promise<
      { ok: true } | { ok: false; reason: 'password' | 'aes' | 'failed'; message?: string }
    > {
      const pw = archivePasswords.get(p) ?? ''
      const exe = seven(p)
      if (exe) {
        // 7-Zip's own percentage, forwarded to the panel: a 2GB archive takes
        // minutes, and a button reading "Extracting..." for minutes is
        // indistinguishable from one that has hung.
        // How many members there are, so the file-count fallback has
        // something to be a fraction OF. One extra 7z listing, measured at
        // 88ms on a 1.9GB archive - nothing against the minutes that follow.
        const listed = await listSeven(exe, p, pw)
        const total = listed.ok ? listed.entries.filter((e) => !e.dir).length : 0
        let last = -1
        const s7 = await extractAllSeven(
          exe,
          p,
          into,
          pw,
          (pct) => {
            if (pct === last) return
            last = pct
            mainWindow?.webContents.send('archive:progress', { path: p, pct })
          },
          total
        )
        return s7.ok ? { ok: true } : { ok: false, reason: s7.reason, message: s7.message }
      }
      // Every top-level entry: extractTo matches members by prefix, and the
      // roots of the tree are what covers all of them.
      const tops = listArchive(p)
        .filter((e) => !e.path.includes('/'))
        .map((e) => e.path)
      const out = await extractTo(p, tops, into, pw || undefined)
      return out.ok ? { ok: true } : { ok: false, reason: out.reason }
    }

    /** A folder to extract into, named after the archive, never overwriting. */
    function landingDir(p: string, parent: string): string {
      const stem = basename(p).replace(/\.[^.]+$/, '') || 'extracted'
      let dest = join(parent, stem)
      for (let n = 2; existsSync(dest) && n < 100; n += 1) dest = join(parent, `${stem} (${n})`)
      return dest
    }

    ipcMain.handle('archive:stat', async (_e, p: string): Promise<ArchiveStat | null> => {
      if (!archiveOk(p)) return null
      const exe = seven(p)
      if (!exe) return archiveStat(p)
      const listed = await listSeven(exe, p, archivePasswords.get(p) ?? '')
      if (!listed.ok) return null
      const list = listed.entries
      return {
        files: list.filter((e) => !e.dir).length,
        folders: list.filter((e) => e.dir).length,
        uncompressed: list.reduce((n, e) => n + (e.dir ? 0 : e.size), 0),
        encryption: list.some((e) => e.encrypted) ? 'aes' : 'none',
        readOnly: true
      }
    })
    // Answers WHY it could not list (2026-08-30). A 7z or rar written with
    // encrypted file NAMES cannot be listed at all without the password, and
    // the old flat null reached the panel as "this archive looks corrupt": a
    // good archive read as broken, with nowhere to type what it was asking
    // for. A password that works is remembered here too, so the member verbs
    // and the drag-out do not ask again.
    ipcMain.handle(
      'archive:list',
      async (_e, p: string, password?: string): Promise<ArchiveListing> => {
        if (!archiveOk(p)) return { ok: false, reason: 'failed' }
        try {
          const exe = seven(p)
          if (!exe) {
            const entries = listArchive(p)
            return entries ? { ok: true, entries } : { ok: false, reason: 'failed' }
          }
          const pw =
            typeof password === 'string' && password ? password : (archivePasswords.get(p) ?? '')
          const listed = await listSeven(exe, p, pw)
          if (listed.ok && pw) archivePasswords.set(p, pw)
          return listed
        } catch {
          return { ok: false, reason: 'failed' }
        }
      }
    )
    type ExtractResult =
      | { ok: true; path: string; kind: FileKind }
      | { ok: false; reason: 'password' | 'aes' | 'failed' }
    ipcMain.handle(
      'archive:extract',
      async (_e, p: string, entry: string, password?: string): Promise<ExtractResult> => {
        if (!archiveOk(p) || typeof entry !== 'string') return { ok: false, reason: 'failed' }
        try {
          const exe = seven(p)
          // The cap is ADM-ZIP's - it reads the whole container into memory.
          // 7-Zip streams, so a 3GB .7z is fine and used to be refused here
          // by a check that ran before the branch (2026-08-28).
          if (!exe && archiveTooLarge(statSync(p).size)) return { ok: false, reason: 'failed' }
          if (exe) {
            const pw = typeof password === 'string' ? password : ''
            const s7 = await extractSeven(exe, p, entry, pw)
            if (!s7.ok) return s7
            if (pw) archivePasswords.set(p, pw)
            extractedPaths.add(s7.path)
            return { ok: true, path: s7.path, kind: fileKind(extname(s7.path), basename(s7.path)) }
          }
          const r = await extractMember(
            p,
            entry,
            typeof password === 'string' ? password : undefined
          )
          if (!r.ok) return r
          extractedPaths.add(r.path)
          return { ok: true, path: r.path, kind: fileKind(extname(r.path), basename(r.path)) }
        } catch {
          return { ok: false, reason: 'failed' }
        }
      }
    )
    /**
     * Extract the WHOLE archive, Explorer-shaped: the user picks where, and
     * the contents land in a folder named after the archive so a zip full of
     * loose files never sprays them over the chosen folder.
     *
     * The destination is chosen in MAIN's own dialog, which is the consent -
     * that is why this one is not bound by the root wall, unlike
     * archive:extract-to, whose destination the renderer names.
     */
    ipcMain.handle(
      'archive:extract-all',
      async (
        _e,
        p: string,
        here?: boolean
      ): Promise<
        | { ok: true; dest: string }
        | { ok: false; reason: 'cancelled' | 'password' | 'aes' | 'failed'; message?: string }
      > => {
        if (!archiveOk(p)) return { ok: false, reason: 'failed' }
        let parent = dirname(p)
        if (!here) {
          // The dialog IS the consent: it is why the destination does not have
          // to be inside a root. "Extract here" needs none, because the
          // archive's own folder already is one.
          const r = await openDialog({
            properties: ['openDirectory', 'createDirectory'],
            defaultPath: dirname(p),
            buttonLabel: 'Extract here'
          })
          if (r.canceled || !r.filePaths.length) return { ok: false, reason: 'cancelled' }
          parent = r.filePaths[0]
        }
        const dest = landingDir(p, parent)
        try {
          mkdirSync(dest, { recursive: true })
          const out = await extractWhole(p, dest)
          if (!out.ok) return out
          return { ok: true, dest: await unwrapSingleFolder(dest, parent) }
        } catch {
          return { ok: false, reason: 'failed' }
        }
      }
    )

    /**
     * A FOLDER inside the archive, extracted whole to a temp copy.
     *
     * The panel's "Copy" on a folder used to extract its members one at a
     * time and put the loose FILES on the clipboard, so pasting gave you a
     * flat pile and never the folder you right-clicked. This hands back one
     * real directory with the shape intact, which is what gets copied.
     */
    ipcMain.handle(
      'archive:extract-dir',
      async (
        _e,
        p: string,
        entry: string,
        here?: boolean
      ): Promise<
        | { ok: true; path: string }
        | { ok: false; reason: 'password' | 'aes' | 'failed'; message?: string }
      > => {
        if (!archiveOk(p) || typeof entry !== 'string' || !entry) {
          return { ok: false, reason: 'failed' }
        }
        try {
          const clean = entry.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
          const name = clean.split('/').pop() || 'folder'
          /**
           * Staged on the DESTINATION's volume when it is going to land
           * somewhere real (2026-08-31).
           *
           * `here` finishes with a rename, and `fs.rename` CANNOT CROSS
           * VOLUMES - it throws EXDEV. The temp directory is on C: and the
           * archive very often is not (an X: drive full of comics is what
           * found this), so every "Extract folder here" onto another disk
           * failed after 7-Zip had already done the work, with no message,
           * because the failure was the move and not the extraction.
           *
           * Staging beside the archive makes the rename same-volume and
           * therefore instant, whatever the folder weighs. The clipboard copy
           * still stages in temp: nothing renames it anywhere.
           */
          const dir = here
            ? mkdtempSync(join(dirname(p), '.prism-extract-'))
            : mkdtempSync(join(tmpdir(), 'prism-arcdir-'))
          const pw = archivePasswords.get(p) ?? ''
          const exe = seven(p)
          let made = join(dir, name)
          if (exe) {
            // ONE 7-Zip call for the whole subtree. The member-at-a-time
            // route spawns a process per file, each re-opening the container:
            // measured on a 2GB zip, a 25-file folder came out in 0.41s as
            // one call, and the folder next to it holds 561 files. That is
            // what "Extract folder here" was failing on.
            let last = -1
            const s7 = await extractSevenSubtree(exe, p, clean, dir, pw, (pct) => {
              if (pct === last) return
              last = pct
              mainWindow?.webContents.send('archive:progress', { path: p, pct })
            })
            if (!s7.ok) return { ok: false, reason: s7.reason, message: s7.message }
            // 7-Zip keeps the full path under -o, so the folder is as deep as
            // its name was.
            made = join(dir, ...clean.split('/'))
          } else {
            const out = await extractTo(p, [clean], dir, pw || undefined)
            if (!out.ok) return { ok: false, reason: out.reason }
          }
          if (!existsSync(made)) return { ok: false, reason: 'failed' }
          if (!here) {
            extractedPaths.add(made)
            return { ok: true, path: made }
          }
          // `here` lands it beside the archive, which is inside a root, so it
          // needs no dialog to consent to. Extracted to staging first and
          // renamed across, so a taken name never merges into somebody
          // else's folder - the same rule extract-all follows.
          const parent = dirname(p)
          let out2 = join(parent, name)
          for (let n = 2; existsSync(out2) && n < 100; n += 1) out2 = join(parent, `${name} (${n})`)
          const fs = await import('fs/promises')
          try {
            await fs.rename(made, out2)
          } catch (e) {
            // Belt and braces: if the stage ever does end up on another
            // volume, copy across rather than answering "failed" for work
            // that has already been done.
            if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
            await fs.cp(made, out2, { recursive: true })
          }
          await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
          return { ok: true, path: out2 }
        } catch {
          return { ok: false, reason: 'failed' }
        }
      }
    )
    ipcMain.handle(
      'archive:rename',
      async (_e, p: string, entry: string, name: string, password?: string): Promise<string> => {
        if (!archiveOk(p) || typeof entry !== 'string' || typeof name !== 'string') return 'failed'
        if (seven(p)) return 'failed' // read-only format; the panel offers no verbs
        try {
          if (archiveTooLarge(statSync(p).size)) return 'failed'
          return await renameMember(
            p,
            entry,
            name,
            typeof password === 'string' ? password : undefined
          )
        } catch {
          return 'failed'
        }
      }
    )
    ipcMain.handle('archive:delete', (_e, p: string, entry: string): boolean => {
      if (!archiveOk(p) || typeof entry !== 'string') return false
      if (seven(p)) return false
      try {
        return !archiveTooLarge(statSync(p).size) && deleteMember(p, entry)
      } catch {
        return false
      }
    })

    ipcMain.handle('file:duplicate', async (_e, p: string): Promise<string | null> => {
      ownWrite(p)
      if (!insideAnyRoot(p)) return null
      try {
        if (!statSync(p).isFile()) return null // folders are a different feature
        const dir = dirname(p)
        // basename, not a slice: dirname keeps its trailing separator at a
        // drive root, and slicing past it ate the name's first character.
        const copy = join(dir, uniqueName(dir, basename(p)))
        await copyFile(p, copy)
        return copy
      } catch {
        return null
      }
    })
    ipcMain.on('window:minimize', () => mainWindow?.minimize())
    ipcMain.on('window:toggle-maximize', () =>
      mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize()
    )
    // Closing with unsaved text asks first. The renderer keeps `editorDirty`
    // current, so the common (clean) path closes with no round trip; only a
    // dirty buffer costs a question. `force` is the renderer saying the user
    // already answered it.
    ipcMain.on('editor:dirty', (_e, d: boolean) => {
      editorDirty = !!d
    })
    ipcMain.on('window:close', (_e, force?: boolean) => {
      if (force) closeConfirmed = true
      mainWindow?.close()
    })
    ipcMain.on('window:set-fullscreen', (_e, on: boolean) => mainWindow?.setFullScreen(!!on))
    // Windows 11 composites acrylic and mica behind the window; CSS can't, since
    // backdrop-filter only sees the app's own pixels. The window background has
    // to go transparent for the material to show through.
    // Windows does not let an app take file associations on its own, and that is
    // the right way round: this opens the list with Prism in it and the choice
    // stays the user's.
    ipcMain.on('app:default-apps', () => {
      // Windows 11 takes a deep link straight to Prism's own page in Default
      // apps, where each file type is one click. The app cannot set them
      // itself: the choice lives in a signed UserChoice key precisely so that
      // no installer can help itself to it. Older builds ignore the query and
      // land on the list, which is still the right list.
      void shell.openExternal('ms-settings:defaultapps?registeredAppUser=Prism')
    })
    ipcMain.on('window:material', (_e, material: string, mode?: string) => {
      if (!mainWindow) return
      const light = mode === 'light'
      wantedMaterial = { material, light }
      try {
        // DWM decides whether its blur is a light or a dark frost from the
        // window's immersive theme, which Electron drives off nativeTheme. Told
        // nothing, a light acrylic style gets a dark frost under white surfaces.
        nativeTheme.themeSource = light ? 'light' : 'dark'
        // Fullscreen keeps the window opaque whatever the style asks for.
        applyMaterial(mainWindow.isFullScreen())
      } catch {
        /* older Windows, or an unsupported value: the solid background stands */
      }
    })

    createWindow()
    void applyVerbDefault()
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
