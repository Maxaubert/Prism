import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DirListing, OnClash, OpenPayload, RenameResult } from '@shared/types'

// The typed bridge the renderer uses. Kept small and stable; prism-core consumes
// `mediaUrl` + the open payload, nothing app-specific.

const api = {
  /** fsmedia:// URL for a local path, so <img>/<video>/<audio>/<embed> can load it. */
  mediaUrl: (path: string): string => `fsmedia://local/${encodeURIComponent(path)}`,

  /** Open the file dialog; resolves with the folder payload or null if cancelled. */
  openDialog: (): Promise<OpenPayload | null> => ipcRenderer.invoke('open:dialog'),
  /** Build a payload for a dropped/known path (drag-and-drop). */
  openPath: (path: string): Promise<OpenPayload | null> => ipcRenderer.invoke('open:path', path),
  /** Open a file the sidebar tree lists. Inside the session root only, and the
   *  root is left alone (unlike openPath, which re-roots). */
  openWithin: (path: string): Promise<OpenPayload | null> => ipcRenderer.invoke('open:within', path),
  /** Children of a folder for the sidebar tree; null if outside the root. */
  listDir: (path: string): Promise<DirListing | null> => ipcRenderer.invoke('dir:list', path),
  /** Rename a file in place. `onClash` decides what a taken name does: 'ask'
   *  reports the clash back so the user can choose. */
  renameFile: (path: string, name: string, onClash: OnClash): Promise<RenameResult> =>
    ipcRenderer.invoke('file:rename', path, name, onClash),
  /** Send a file to the Recycle Bin. */
  trashFile: (path: string): Promise<boolean> => ipcRenderer.invoke('file:trash', path),
  /** Read a small text file (for the text/code/markdown viewer). */
  readText: (path: string): Promise<string | null> => ipcRenderer.invoke('file:text', path),
  /** Absolute path of a dropped File (Electron removed File.path). */
  getDroppedPath: (file: File): string => webUtils.getPathForFile(file),

  /** Fired when main opens a file (launch arg, drag, or a forwarded second instance). */
  onOpenFile: (cb: (p: OpenPayload) => void): (() => void) => {
    const listener = (_: unknown, p: OpenPayload): void => cb(p)
    ipcRenderer.on('open:file', listener)
    return () => ipcRenderer.removeListener('open:file', listener)
  },

  // frameless window controls
  minimize: (): void => ipcRenderer.send('window:minimize'),
  toggleMaximize: (): void => ipcRenderer.send('window:toggle-maximize'),
  close: (): void => ipcRenderer.send('window:close'),
  setFullscreen: (on: boolean): void => ipcRenderer.send('window:set-fullscreen', on),
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
