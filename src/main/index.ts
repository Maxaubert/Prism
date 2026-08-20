import {
  app,
  protocol,
  shell,
  screen,
  BrowserWindow,
  ipcMain,
  dialog,
  nativeTheme,
  utilityProcess
} from 'electron'
import { basename, dirname, extname, join, resolve } from 'path'
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'fs'
import { copyFile, readFile, writeFile } from 'fs/promises'
import { execFile, spawn } from 'child_process'
import { Readable } from 'stream'
import { listDir, searchFiles, toViewerFile } from './dirList'
import { addRoot, insideAnyRoot, isAnyRoot, syncRoots, validRoot } from './roots'
import { readTabs, writeTabs, type SavedTabs } from './tabs'
import { renameFile, uniqueName } from './fileOps'
import { appsForExt, argsFor, type AppCandidate } from './openWith'
import { readAsVtt, sidecarsFor, type SubTrack } from './subtitles'
import { fileKind } from '@shared/fileKind'
import type { DirListing, OnClash, OpenPayload, OpenWithApp, RenameResult } from '@shared/types'

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

/**
 * Build the open payload for a path: the folder's viewable siblings, the index
 * of the opened file (so the renderer can arrow through them), and the root.
 *
 * `root` is the tab's existing root, for a click inside a tree that must not
 * move. Omitted, the file's own folder becomes a root: that is what an open
 * from outside (launch argv, handoff, dialog, drag) does, and the renderer
 * decides from `root` whether that lands in an existing tab or a new one.
 */
function buildPayload(p: string, root?: string): OpenPayload | null {
  if (!existsSync(p)) return null
  const dir = dirname(p)
  if (root === undefined) addRoot(dir)
  const here = root ?? dir
  const files = listDir(dir).files
  const idx = files.findIndex((v) => resolve(v.path) === resolve(p))
  // An opened file the tree wouldn't list (an unknown extension) still shows,
  // alone: you asked for this file, so you get it.
  if (idx < 0) return { files: [toViewerFile(p)], index: 0, root: here }
  return { files, index: idx, root: here }
}

/** Build the open payload for a FOLDER the user chose: the tree roots there and
 *  the viewer shows its first viewable file. A folder holding nothing Prism can
 *  show still opens - you get its tree and an empty viewer, which is a usable
 *  place to browse from rather than a refusal. */
function folderPayload(dir: string): OpenPayload | null {
  if (!existsSync(dir)) return null
  addRoot(dir)
  const files = listDir(dir).files
  return { files, index: files.length ? 0 : -1, root: dir }
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
/** The renderer's editor holds unsaved text. Mirrored here so `close` can ask. */
let editorDirty = false
/** The user has answered the "unsaved changes" question: let the close through. */
let closeConfirmed = false

function sendOpen(p: string): void {
  const payload = buildPayload(p) // came from outside: it becomes the root
  if (payload && mainWindow) mainWindow.webContents.send('open:file', payload)
}

const TABS_STATE = (): string => join(app.getPath('userData'), 'tabs.json')

/** Restore last session's strip: register each surviving root so the wall
 *  accepts it, then hand the renderer the payloads to rebuild the tabs from. */
function restoreTabs(): OpenPayload[] {
  const saved = readTabs(TABS_STATE())
  const out: OpenPayload[] = []
  for (const t of saved.tabs) {
    const payload = t.file ? buildPayload(t.file) : folderPayload(t.root)
    if (payload) out.push(payload)
  }
  // The active tab goes last: the renderer applies these in order through the
  // same arriving-file rule as everything else, and that rule leaves the tab it
  // just handled in front.
  const front = out.splice(saved.active, 1)
  return [...out, ...front]
}

/** Save on a delay, as the window state does: switching tabs with the arrow
 *  keys fires this continuously and the disk need not hear about each one. */
let tabsTimer: NodeJS.Timeout | null = null
function saveTabs(state: SavedTabs): void {
  if (tabsTimer) clearTimeout(tabsTimer)
  tabsTimer = setTimeout(() => writeTabs(TABS_STATE(), state), 400)
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
  // Every route out of the window ends here: the title bar's X, Alt+F4, the
  // taskbar, Escape. Unsaved text stops all of them until the user answers.
  win.on('close', (e) => {
    if (!editorDirty || closeConfirmed) return
    e.preventDefault()
    win.webContents.send('app:ask-close')
    // A minimised or background window can't show its own dialog usefully.
    if (win.isMinimized()) win.restore()
    win.focus()
  })
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
      /* Chromium throttles a window nobody can see down to about a frame a
       * second, which is right for a viewer sitting in the background and wrong
       * for the recorder: it films off-screen so it does not have to take over
       * the display, and a throttled window films as a slideshow. Only --demo
       * turns it off, so nothing about normal use changes. */
      backgroundThrottling: !process.argv.includes('--demo'),
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
    mainWindow?.show()
  })
  watchWindowState(mainWindow)
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

  // Rebuild last session's strip, then deliver whatever the app was launched
  // with. Order matters: the launch file goes through the same arriving-file
  // rule as everything else, so double-clicking a photo in a folder that was
  // already open lands in that tab rather than opening a second copy of it.
  mainWindow.webContents.on('did-finish-load', () => {
    for (const payload of restoreTabs()) mainWindow?.webContents.send('open:file', payload)
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
    // Choosing a folder rather than a file: the other way in, and the only one
    // that names the root deliberately instead of inferring it from a file.
    ipcMain.handle('open:folder', async (): Promise<OpenPayload | null> => {
      const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
      if (r.canceled || !r.filePaths.length) return null
      return folderPayload(r.filePaths[0])
    })
    ipcMain.handle('open:path', (_e, p: string): OpenPayload | null => buildPayload(p))
    // The renderer owns the tab list; main only persists it and keeps the wall
    // in step, so a root whose tab was closed stops being reachable.
    ipcMain.on('tabs:changed', (_e, state: SavedTabs) => {
      syncRoots(state.tabs.map((t) => t.root))
      saveTabs(state)
    })
    // The three navigation handlers take the root they act in, because they are
    // per-tab operations and the renderer always knows which tab asked. Both the
    // root and the path have to hold up: naming a root you never opened gets you
    // nothing, and neither does a path from a DIFFERENT open root.
    //
    // A click in the sidebar tree. It leaves the root alone: the tree you
    // clicked from stays the tree you're in.
    ipcMain.handle('open:within', (_e, root: string, p: string): OpenPayload | null =>
      validRoot(root, p) ? buildPayload(p, root) : null
    )
    ipcMain.handle('dir:list', (_e, root: string, p: string): DirListing | null =>
      validRoot(root, p) ? listDir(p) : null
    )
    // The sidebar's search: that tab's whole root, bounded, never outside it.
    ipcMain.handle('search:files', (_e, root: string, query: string) =>
      validRoot(root, root) ? searchFiles(root, query) : { hits: [], truncated: false }
    )
    // File operations. Inside the root only, and nothing is ever destroyed: an
    // overwritten or deleted file goes to the Recycle Bin.
    // The root itself is off limits: renaming or binning the folder the tree is
    // rooted in would pull the ground out from under the window.
    const editable = (p: string): boolean => insideAnyRoot(p) && !isAnyRoot(p)

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
    // The same wall as every other handler. A text file only ever reaches the
    // renderer from inside the session root, and opening one from outside
    // re-roots first, so this refuses nothing the app legitimately asks for.
    ipcMain.handle('file:text', async (_e, p: string): Promise<string | null> => {
      if (!insideAnyRoot(p)) return null
      try {
        return (await import('fs/promises')).readFile(p, 'utf-8')
      } catch {
        return null
      }
    })
    // The editor's save. Text files only, in place, inside the root: this is
    // the third thing Prism writes (after rename and bin), and the narrowest.
    ipcMain.handle('file:write', async (_e, p: string, text: string): Promise<boolean> => {
      if (!insideAnyRoot(p) || !existsSync(p)) return false
      if (fileKind(extname(p).toLowerCase(), basename(p)) !== 'text') return false
      try {
        await writeFile(p, text, 'utf-8')
        return true
      } catch {
        return false
      }
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
    ipcMain.handle('subs:read', (_e, p: string): string | null =>
      insideAnyRoot(p) ? readAsVtt(p) : null
    )

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
    ipcMain.handle('file:copy-clip', (_e, p: string): Promise<boolean> => {
      if (!insideAnyRoot(p)) return Promise.resolve(false)
      const quoted = p.replace(/'/g, "''")
      return new Promise((done) => {
        execFile(
          'powershell.exe',
          ['-NoProfile', '-Command', `Set-Clipboard -LiteralPath '${quoted}'`],
          { windowsHide: true, timeout: 5000 },
          (err) => done(!err)
        )
      })
    })

    ipcMain.handle('file:duplicate', async (_e, p: string): Promise<string | null> => {
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
      try {
        // DWM decides whether its blur is a light or a dark frost from the
        // window's immersive theme, which Electron drives off nativeTheme. Told
        // nothing, a light acrylic style gets a dark frost under white surfaces.
        nativeTheme.themeSource = light ? 'light' : 'dark'
        const m = material as 'none' | 'acrylic' | 'mica' | 'tabbed'
        mainWindow.setBackgroundColor(m === 'none' ? (light ? '#f7f7f9' : '#111318') : '#00000000')
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
