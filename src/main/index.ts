import { app, protocol, shell, BrowserWindow, ipcMain, dialog, utilityProcess } from 'electron'
import { dirname, extname, join, resolve } from 'path'
import { createReadStream, existsSync, statSync } from 'fs'
import { readFile } from 'fs/promises'
import { Readable } from 'stream'
import { isInsideRoot, isRoot, listDir, toViewerFile } from './dirList'
import { renameFile } from './fileOps'
import type { DirListing, OnClash, OpenPayload, RenameResult } from '@shared/types'

// Prism main process. Phase 0 scaffold: a frameless window, the fsmedia:// media
// protocol (Range-aware so <video>/<audio> can seek), and open-file routing
// (launch argv, single-instance forward, drag-drop, dialog). The viewer itself is
// a placeholder in the renderer until prism-core lands (Phase 1).

const MEDIA_SCHEME = 'fsmedia'
protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    // corsEnabled so an <audio crossorigin> element served over fsmedia:// is not
    // "tainted" — otherwise a MediaElementSource feeds the AnalyserNode silence and
    // the audio visualizer would sit dead. Paired with the ACAO header in serveMedia.
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true }
  }
])

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg',
  '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg',
  '.opus': 'audio/opus', '.flac': 'audio/flac', '.wav': 'audio/wav',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.avif': 'image/avif',
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

async function heicToJpeg(filePath: string, mtimeMs: number): Promise<Buffer> {
  const key = `${filePath}|${mtimeMs}`
  const hit = heicCache.get(key)
  if (hit) {
    heicCache.delete(key)
    heicCache.set(key, hit) // LRU touch
    return hit
  }
  const id = ++heicSeq
  const buf = await new Promise<Buffer>((resolve, reject) => {
    heicPending.set(id, { resolve, reject })
    heicWorker().postMessage({ id, path: filePath })
  })
  heicCache.set(key, buf)
  if (heicCache.size > HEIC_CACHE_MAX) {
    const oldest = heicCache.keys().next().value
    if (oldest) heicCache.delete(oldest)
  }
  return buf
}

// Serve a local file honouring Range requests (206), so media can seek. Mirrors
// Filesmith's serveMedia; becomes part of prism-core in Phase 1.
async function serveMedia(request: Request): Promise<Response> {
  let filePath: string
  try {
    filePath = decodeURIComponent(new URL(request.url).pathname).slice(1)
  } catch {
    return new Response(null, { status: 400 })
  }
  let st: ReturnType<typeof statSync>
  try {
    st = statSync(filePath)
  } catch {
    return new Response(null, { status: 404 })
  }

  const ext = extname(filePath).toLowerCase()
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

// The folder Prism was opened in. The sidebar tree is bounded by it and every
// directory request is checked against it, so the renderer can never walk out.
// Only an open from outside (launch argv, handoff, dialog, drag) moves it.
let sessionRoot = ''

/** Build the open payload for a path: the folder's viewable siblings, the index
 * of the opened file (so the renderer can arrow through them), and the session
 * root. `reroot` is set for opens that come from outside the app. */
function buildPayload(p: string, reroot: boolean): OpenPayload | null {
  if (!existsSync(p)) return null
  const dir = dirname(p)
  if (reroot || !sessionRoot) sessionRoot = dir
  const files = listDir(dir).files
  const idx = files.findIndex((v) => resolve(v.path) === resolve(p))
  // An opened file the tree wouldn't list (an unknown extension) still shows,
  // alone: you asked for this file, so you get it.
  if (idx < 0) return { files: [toViewerFile(p)], index: 0, root: sessionRoot }
  return { files, index: idx, root: sessionRoot }
}

/** The file path an OS "open" passed us, if any (last argv entry that's a file). */
function pathFromArgv(argv: string[]): string | null {
  for (let i = argv.length - 1; i >= 1; i -= 1) {
    const a = argv[i]
    if (a.startsWith('--')) continue
    try {
      if (existsSync(a) && statSync(a).isFile()) return a
    } catch {
      /* ignore */
    }
  }
  return null
}

let mainWindow: BrowserWindow | null = null
let pendingOpen: string | null = null

function sendOpen(p: string): void {
  const payload = buildPayload(p, true) // came from outside: it becomes the root
  if (payload && mainWindow) mainWindow.webContents.send('open:file', payload)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 560,
    minHeight: 400,
    show: false,
    // Not `frame: false`: DWM refuses to composite acrylic or mica behind a
    // frameless window, which is why a translucent style came out as a hole in
    // the screen. 'hidden' drops the caption but keeps the frame DWM needs, and
    // the custom title bar still draws over it.
    titleBarStyle: 'hidden',
    backgroundColor: '#111318',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })
  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => (mainWindow = null))
  mainWindow.on('enter-full-screen', () => mainWindow?.webContents.send('window:fullscreen', true))
  mainWindow.on('leave-full-screen', () => mainWindow?.webContents.send('window:fullscreen', false))
  mainWindow.webContents.setWindowOpenHandler((d) => {
    void shell.openExternal(d.url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void mainWindow.loadURL(devUrl)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))

  // Deliver any file the app was launched with, once the renderer is ready.
  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingOpen) {
      sendOpen(pendingOpen)
      pendingOpen = null
    }
  })
}

// Single instance: a second launch (opening another file) forwards its path to
// the running window and focuses it, instead of spawning a rival process.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const p = pathFromArgv(argv)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      if (p) sendOpen(p)
    }
  })

  pendingOpen = pathFromArgv(process.argv)

  app.whenReady().then(() => {
    protocol.handle(MEDIA_SCHEME, (request) => serveMedia(request))

    ipcMain.handle('open:dialog', async (): Promise<OpenPayload | null> => {
      const r = await dialog.showOpenDialog({ properties: ['openFile'] })
      if (r.canceled || !r.filePaths.length) return null
      return buildPayload(r.filePaths[0], true)
    })
    ipcMain.handle('open:path', (_e, p: string): OpenPayload | null => buildPayload(p, true))
    // A click in the sidebar tree. Inside the root only, and it leaves the root
    // alone: the tree you clicked from stays the tree you're in.
    ipcMain.handle('open:within', (_e, p: string): OpenPayload | null =>
      isInsideRoot(sessionRoot, p) ? buildPayload(p, false) : null
    )
    ipcMain.handle('dir:list', (_e, p: string): DirListing | null =>
      isInsideRoot(sessionRoot, p) ? listDir(p) : null
    )
    // File operations. Inside the root only, and nothing is ever destroyed: an
    // overwritten or deleted file goes to the Recycle Bin.
    // The root itself is off limits: renaming or binning the folder the tree is
    // rooted in would pull the ground out from under the window.
    const editable = (p: string): boolean => isInsideRoot(sessionRoot, p) && !isRoot(sessionRoot, p)

    ipcMain.handle(
      'file:rename',
      async (_e, p: string, name: string, onClash: OnClash): Promise<RenameResult> =>
        editable(p)
          ? renameFile(p, name, onClash, (t) => shell.trashItem(t))
          : { ok: false, reason: 'failed', message: 'That folder is the one Prism opened in.' }
    )
    ipcMain.handle('file:trash', async (_e, p: string): Promise<boolean> => {
      if (!editable(p)) return false
      try {
        await shell.trashItem(p)
        return true
      } catch {
        return false
      }
    })
    ipcMain.handle('file:text', async (_e, p: string): Promise<string | null> => {
      try {
        return (await import('fs/promises')).readFile(p, 'utf-8')
      } catch {
        return null
      }
    })
    ipcMain.on('window:minimize', () => mainWindow?.minimize())
    ipcMain.on('window:toggle-maximize', () =>
      mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize()
    )
    ipcMain.on('window:close', () => mainWindow?.close())
    ipcMain.on('window:set-fullscreen', (_e, on: boolean) => mainWindow?.setFullScreen(!!on))
    // Windows 11 composites acrylic and mica behind the window; CSS can't, since
    // backdrop-filter only sees the app's own pixels. The window background has
    // to go transparent for the material to show through.
    ipcMain.on('window:material', (_e, material: string) => {
      if (!mainWindow) return
      try {
        const m = material as 'none' | 'acrylic' | 'mica' | 'tabbed'
        mainWindow.setBackgroundColor(m === 'none' ? '#111318' : '#00000000')
        mainWindow.setBackgroundMaterial(m)
      } catch {
        /* older Windows, or an unsupported value: the solid background stands */
      }
    })

    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
