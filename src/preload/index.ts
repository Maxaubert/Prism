import { clipboard, contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DirListing, FileKind, OnClash, OpenPayload, OpenWithApp, RenameResult, SearchResult, ShellDef, MediaProbe } from '@shared/types'

// The typed bridge the renderer uses. Kept small and stable; prism-core consumes
// `mediaUrl` + the open payload, nothing app-specific.

const api = {
  /** fsmedia:// URL for a local path, so <img>/<video>/<audio>/<embed> can load it. */
  mediaUrl: (path: string): string => `fsmedia://local/${encodeURIComponent(path)}`,

  /** Open the file dialog; resolves with the folder payload or null if cancelled. */
  openDialog: (): Promise<OpenPayload | null> => ipcRenderer.invoke('open:dialog'),
  /** Build a payload for a dropped/known path (drag-and-drop). */
  openPath: (path: string): Promise<OpenPayload | null> => ipcRenderer.invoke('open:path', path),
  /** Choose a FOLDER to root in. The only way to name a root deliberately;
   *  every other route infers it from the file that arrived. */
  openFolder: (from?: string): Promise<OpenPayload | null> =>
    ipcRenderer.invoke('open:folder', from),
  /** A new tab rooted at the user's own folder. No dialog: the + is instant. */
  openHome: (): Promise<OpenPayload | null> => ipcRenderer.invoke('open:home'),
  /** A new tab rooted at a remembered folder (the Settings choice). */
  openRoot: (dir: string): Promise<OpenPayload | null> => ipcRenderer.invoke('open:root', dir),
  /** Choose a folder without opening it: the Settings picker. */
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:pick-folder'),
  /** Report the tab strip, for persistence only. The root wall is never
   *  rebuilt from a snapshot (it raced payloads in flight); see dropRoot. */
  tabsChanged: (
    tabs: Array<{ root: string; file?: string; term?: 'full' | 'split'; agent?: 'claude' | 'codex' }>,
    active: number
  ): void => ipcRenderer.send('tabs:changed', { tabs, active }),
  /** A root no longer held by any tab. The one way the wall shrinks. */
  dropRoot: (root: string): void => ipcRenderer.send('roots:drop', root),
  // The three navigation calls name the root they act in. They are per-tab
  // operations, the caller always knows which tab is asking, and main refuses a
  // root that is not open as well as a path from a different one.
  /** Open a file the sidebar tree lists. Inside `root` only, and it leaves the
   *  root alone (unlike openPath, which opens a root of its own). */
  openWithin: (root: string, path: string): Promise<OpenPayload | null> =>
    ipcRenderer.invoke('open:within', root, path),
  /** Children of a folder for the sidebar tree; null if outside `root`. */
  listDir: (root: string, path: string): Promise<DirListing | null> =>
    ipcRenderer.invoke('dir:list', root, path),
  /** Name search under `root`: bounded, breadth-first, capped. */
  searchTree: (root: string, query: string): Promise<SearchResult> =>
    ipcRenderer.invoke('search:files', root, query),
  /** Rename a file in place. `onClash` decides what a taken name does: 'ask'
   *  reports the clash back so the user can choose. */
  renameFile: (path: string, name: string, onClash: OnClash): Promise<RenameResult> =>
    ipcRenderer.invoke('file:rename', path, name, onClash),
  /** Send a file to the Recycle Bin. */
  trashFile: (path: string): Promise<boolean> => ipcRenderer.invoke('file:trash', path),
  /** Read a small text file (for the text/code/markdown viewer). */
  readText: (path: string): Promise<string | null> => ipcRenderer.invoke('file:text', path),
  /** Save the editor's text over the file. Text kinds only, inside the root. */
  writeText: (path: string, text: string): Promise<boolean> =>
    ipcRenderer.invoke('file:write', path, text),

  /** Size, modified time and folder-ness for the Properties popup. */
  statFile: (path: string): Promise<{ size: number; mtimeMs: number; isFolder: boolean } | null> =>
    ipcRenderer.invoke('file:stat', path),
  /** Sidecar subtitle tracks for a video (same name beside it, or in Subs/). */
  subsFor: (path: string): Promise<Array<{ path: string; label: string }>> =>
    ipcRenderer.invoke('subs:for', path),
  /** One track's text as WebVTT (SRT converted), for a <track> blob. */
  readSubs: (path: string): Promise<string | null> => ipcRenderer.invoke('subs:read', path),

  /** Does this file's audio need Prism's own decoder (AC-3, DTS, TrueHD and
   *  friends, none of which Chromium can play), and where is it served. */
  probeMedia: (path: string): Promise<MediaProbe> => ipcRenderer.invoke('media:probe', path),
  /** The same stream without a probe: for when the player itself noticed the
   *  audio never decoded, and can name the duration off the element. */
  audioBlind: (path: string, duration: number): Promise<string | null> =>
    ipcRenderer.invoke('audio:blind', path, duration),

  /* ----- context-menu verbs ----- */

  /** Reveal (and select) the file or folder in File Explorer. */
  showInExplorer: (path: string): void => ipcRenderer.send('file:show-in-explorer', path),
  /** Hand the file to whatever Windows has as its default app. */
  openInDefault: (path: string): void => ipcRenderer.send('file:open-default', path),
  /** The Windows "how do you want to open this?" chooser. */
  openWithChooser: (path: string): void => ipcRenderer.send('file:open-chooser', path),
  /** Apps Windows registers for this file's extension, MRU first, with icons. */
  appsFor: (path: string): Promise<OpenWithApp[]> => ipcRenderer.invoke('apps:for', path),
  /** Launch one of the apps `appsFor` listed (by its id). */
  openWith: (path: string, appId: string): Promise<boolean> =>
    ipcRenderer.invoke('file:open-with', path, appId),
  /** Put the real file on the clipboard, so Ctrl+V in Explorer pastes it. */
  copyFileToClipboard: (path: string): Promise<boolean> =>
    ipcRenderer.invoke('file:copy-clip', path),
  /** A multi-selection's copy: every file lands on the clipboard together. */
  copyFilesToClipboard: (paths: string[]): Promise<boolean> =>
    ipcRenderer.invoke('file:copy-clip', paths),
  /** Copy the file next to itself as "name (2).ext"; resolves with the new path. */
  duplicateFile: (path: string): Promise<string | null> =>
    ipcRenderer.invoke('file:duplicate', path),

  /* ----- drag and drop (#70) ----- */

  /** Undo a delete: ask Windows for these paths back out of the Recycle Bin. */
  restoreFromBin: (paths: string[]): Promise<boolean> => ipcRenderer.invoke('file:restore', paths),
  /** Move files and folders into another folder. 'ask' reports clashes and
   *  moves nothing, so the user answers before anything happens. */
  moveEntries: (
    paths: string[],
    destDir: string,
    onClash: 'ask' | 'keep-both' | 'replace'
  ): Promise<{
    moved: Array<{ from: string; to: string }>
    clashes: Array<{ path: string; name: string }>
    failed: string[]
    /** What 'replace' binned, so undo can bring it back. */
    replaced: string[]
    /** True when the ROOT WALL refused, which is a different message. */
    refused?: boolean
  }> =>
    ipcRenderer.invoke('file:move', paths, destDir, onClash),
  /** Put real files and folders INTO a zip, under a folder ('' is the root). */
  archiveAdd: (
    zip: string,
    srcPaths: string[],
    destFolder: string,
    keepBoth?: boolean
  ): Promise<
    | { added: Array<{ src: string; entry: string }>; clashes: string[]; failed: string[] }
    | 'encrypted'
    | 'failed'
  > =>
    ipcRenderer.invoke('archive:add', zip, srcPaths, destFolder, keepBoth),
  /** Move members to another folder inside the same zip. */
  archiveMoveMembers: (
    zip: string,
    entries: string[],
    destFolder: string
  ): Promise<'ok' | 'encrypted' | 'failed'> =>
    ipcRenderer.invoke('archive:move-members', zip, entries, destFolder),
  /** Extract members OUT to a real folder, keeping the shape under a folder. */
  archiveExtractTo: (
    zip: string,
    entries: string[],
    destDir: string,
    password?: string
  ): Promise<{ ok: true; written: number } | { ok: false; reason: 'password' | 'aes' | 'failed' }> =>
    ipcRenderer.invoke('archive:extract-to', zip, entries, destDir, password),

  /** The system's own icon for this file's type (the user's association),
   *  as a data URL; null when Windows has none to give. */
  iconForExt: (path: string): Promise<string | null> => ipcRenderer.invoke('icon:for-ext', path),

  /* ----- archives (zip): list, view, rename, delete members ----- */

  /** What an archive holds, for the Properties dialog. */
  archiveStat: (
    path: string
  ): Promise<{ files: number; folders: number; uncompressed: number; encryption: 'none' | 'zipcrypto' | 'aes' } | null> =>
    ipcRenderer.invoke('archive:stat', path),
  /** Every entry in the archive (folders derived when the zip omits them). */
  archiveList: (
    path: string
  ): Promise<Array<{ path: string; name: string; dir: boolean; size: number; encrypted?: boolean }> | null> =>
    ipcRenderer.invoke('archive:list', path),
  /** Extract one member to temp for viewing. 'password' means one is needed
   *  or the given one is wrong; 'aes' encryption cannot be opened at all. */
  archiveExtract: (
    path: string,
    entry: string,
    password?: string
  ): Promise<{ ok: true; path: string; kind: FileKind } | { ok: false; reason: 'password' | 'aes' | 'failed' }> =>
    ipcRenderer.invoke('archive:extract', path, entry, password),
  /** Rename one member in place (same folder). A taken name refuses. */
  archiveRename: (
    path: string,
    entry: string,
    name: string,
    password?: string
  ): Promise<'ok' | 'password' | 'aes' | 'failed'> =>
    ipcRenderer.invoke('archive:rename', path, entry, name, password),
  /** Remove one member. Permanent - no recycle bin inside a zip. */
  archiveDelete: (path: string, entry: string): Promise<boolean> =>
    ipcRenderer.invoke('archive:delete', path, entry),
  /** Absolute path of a dropped File (Electron removed File.path). */
  getDroppedPath: (file: File): string => webUtils.getPathForFile(file),

  /** Fired when main opens a file (launch arg, drag, or a forwarded second instance). */
  onOpenFile: (cb: (p: OpenPayload) => void): (() => void) => {
    const listener = (_: unknown, p: OpenPayload): void => cb(p)
    ipcRenderer.on('open:file', listener)
    return () => ipcRenderer.removeListener('open:file', listener)
  },

  /* ----- the terminal ----- */

  /** The shells main detected; the only things term:spawn will ever launch. */
  termShells: (): Promise<ShellDef[]> => ipcRenderer.invoke('term:shells'),
  termSpawn: (id: string, root: string, shellId?: string, resume?: string): Promise<boolean> =>
    ipcRenderer.invoke('term:spawn', id, root, shellId, resume),
  termInput: (id: string, data: string): void => ipcRenderer.send('term:input', id, data),
  termResize: (id: string, cols: number, rows: number): void =>
    ipcRenderer.send('term:resize', id, cols, rows),
  termKill: (id: string): void => ipcRenderer.send('term:kill', id),
  /** Start the active root's shell ahead of the click. Best-effort. */
  termPrewarm: (root: string, shellId?: string): void =>
    ipcRenderer.send('term:prewarm', root, shellId),
  onTermData: (cb: (id: string, data: string) => void): (() => void) => {
    const listener = (_: unknown, id: string, data: string): void => cb(id, data)
    ipcRenderer.on('term:data', listener)
    return () => ipcRenderer.removeListener('term:data', listener)
  },
  /** An AI CLI (Claude Code, codex...) appeared or left a session's shell. */
  onTermAgent: (cb: (id: string, present: boolean, kind?: 'claude' | 'codex' | 'other' | null) => void): (() => void) => {
    const listener = (_: unknown, id: string, present: boolean, kind?: 'claude' | 'codex' | 'other' | null): void =>
      cb(id, present, kind)
    ipcRenderer.on('term:agent', listener)
    return () => ipcRenderer.removeListener('term:agent', listener)
  },
  onTermExit: (cb: (id: string) => void): (() => void) => {
    const listener = (_: unknown, id: string): void => cb(id)
    ipcRenderer.on('term:exit', listener)
    return () => ipcRenderer.removeListener('term:exit', listener)
  },
  /**
   * What the clipboard holds RIGHT NOW, for the terminal's paste rule. An
   * image forwards the ^V key (a clipboard-aware TUI like Claude Code reads
   * the image itself); text becomes a bracketed paste; copied files paste as
   * quoted paths. The decision itself is pure and lives in lib/termPaste.
   */
  readClipboard: (): { image: boolean; text: string; files: string[] } => {
    const formats = clipboard.availableFormats()
    const files = formats.includes('FileNameW')
      ? clipboard
          .readBuffer('FileNameW')
          .toString('ucs2')
          .replace(/\0+$/, '')
          .split('\0')
          .filter(Boolean)
      : []
    return { image: formats.some((f) => f.startsWith('image/')), text: clipboard.readText(), files }
  },
  /** The web-links addon's click-through: external URLs go to the OS browser. */
  openExternal: (url: string): void => {
    if (/^https?:/i.test(url)) ipcRenderer.send('shell:open-external', url)
  },

  // frameless window controls
  minimize: (): void => ipcRenderer.send('window:minimize'),
  toggleMaximize: (): void => ipcRenderer.send('window:toggle-maximize'),
  /** `force` means the unsaved-changes question has already been answered. */
  close: (force = false): void => ipcRenderer.send('window:close', force),
  /** Keep main in step with the editor, so closing can ask before it discards. */
  setDirty: (dirty: boolean): void => ipcRenderer.send('editor:dirty', dirty),
  /** Main blocked a close because the editor is dirty: put the question up. */
  onAskClose: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('app:ask-close', listener)
    return () => ipcRenderer.removeListener('app:ask-close', listener)
  },
  setFullscreen: (on: boolean): void => ipcRenderer.send('window:set-fullscreen', on),
  /* ----- the update check ----- */
  /** A newer release exists (mock: true in unpackaged builds, as a preview). */
  onUpdate: (cb: (info: { version: string; url: string; mock?: boolean }) => void): (() => void) => {
    const listener = (_: unknown, info: { version: string; url: string; mock?: boolean }): void =>
      cb(info)
    ipcRenderer.on('update:available', listener)
    // Ask main to replay an offer that arrived before this renderer loaded.
    ipcRenderer.send('update:announce')
    return () => ipcRenderer.removeListener('update:available', listener)
  },
  /** Download percentage while an update installs. */
  onUpdateProgress: (cb: (pct: number) => void): (() => void) => {
    const listener = (_: unknown, pct: number): void => cb(pct)
    ipcRenderer.on('update:progress', listener)
    return () => ipcRenderer.removeListener('update:progress', listener)
  },
  /** Download the named installer and hand off to it; the app quits under it. */
  installUpdate: (url: string): Promise<boolean> => ipcRenderer.invoke('update:install', url),
  /** Open the Windows "Default apps" page, where Prism can be chosen. */
  openDefaultApps: (): void => ipcRenderer.send('app:default-apps'),
  /** True when setup asked for the first-run guide, whatever this machine has
   *  already seen. */
  forceSetup: process.argv.includes('--prism-setup'),
  /** True when the process was started with --demo. It opens one door and only
   *  that door: the recording harness can change the style while a file plays,
   *  which Settings cannot do without covering the file it is meant to show. */
  demo: process.argv.includes('--prism-demo'),
  /** Ask Windows for a translucent window material ('acrylic', 'mica', 'none'),
   *  in the given mode: DWM tints its own blur, so it has to be told. */
  setWindowMaterial: (material: string, mode: string): void =>
    ipcRenderer.send('window:material', material, mode),
  onFullscreen: (cb: (on: boolean) => void): (() => void) => {
    const listener = (_: unknown, on: boolean): void => cb(on)
    ipcRenderer.on('window:fullscreen', listener)
    return () => ipcRenderer.removeListener('window:fullscreen', listener)
  }
}

contextBridge.exposeInMainWorld('prism', api)

export type PrismApi = typeof api
