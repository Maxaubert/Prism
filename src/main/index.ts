import { app, protocol, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { basename, dirname, extname, join, resolve } from 'path'
import { createReadStream, existsSync, readdirSync, statSync } from 'fs'
import { Readable } from 'stream'
import { fileKind, isViewable } from '@shared/fileKind'
import type { OpenPayload, ViewerFile } from '@shared/types'

// Prism main process. Phase 0 scaffold: a frameless window, the fsmedia:// media
// protocol (Range-aware so <video>/<audio> can seek), and open-file routing
// (launch argv, single-instance forward, drag-drop, dialog). The viewer itself is
// a placeholder in the renderer until prism-core lands (Phase 1).

const MEDIA_SCHEME = 'fsmedia'
protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true }
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

// Serve a local file honouring Range requests (206), so media can seek. Mirrors
// Filesmith's serveMedia; becomes part of prism-core in Phase 1.
function serveMedia(request: Request): Response {
  let filePath: string
  try {
    filePath = decodeURIComponent(new URL(request.url).pathname).slice(1)
  } catch {
    return new Response(null, { status: 400 })
  }
  let size: number
  try {
    size = statSync(filePath).size
  } catch {
    return new Response(null, { status: 404 })
  }
  const type = mimeFor(filePath)
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

function toViewerFile(p: string): ViewerFile {
  const ext = extname(p).toLowerCase()
  return { path: p, name: basename(p), ext, kind: fileKind(ext) }
}

/** Build the open payload for a path: the folder's viewable siblings + the index
 * of the opened file (so the renderer can arrow through them). */
function buildPayload(p: string): OpenPayload | null {
  if (!existsSync(p)) return null
  try {
    const dir = dirname(p)
    const files = readdirSync(dir)
      .map((n) => join(dir, n))
      .filter((f) => {
        try {
          return statSync(f).isFile() && isViewable(extname(f))
        } catch {
          return false
        }
      })
      .map(toViewerFile)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    const idx = files.findIndex((v) => resolve(v.path) === resolve(p))
    if (idx < 0) return { files: [toViewerFile(p)], index: 0 } // opened file not viewable-listed; show it alone
    return { files, index: idx }
  } catch {
    return { files: [toViewerFile(p)], index: 0 }
  }
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
  const payload = buildPayload(p)
  if (payload && mainWindow) mainWindow.webContents.send('open:file', payload)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 560,
    minHeight: 400,
    show: false,
    frame: false,
    backgroundColor: '#111318',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })
  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => (mainWindow = null))
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
      return buildPayload(r.filePaths[0])
    })
    ipcMain.handle('open:path', (_e, p: string): OpenPayload | null => buildPayload(p))
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

    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
