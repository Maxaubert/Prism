import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { OpenPayload } from '@shared/types'

// The typed bridge the renderer uses. Kept small and stable; prism-core consumes
// `mediaUrl` + the open payload, nothing app-specific.

const api = {
  /** fsmedia:// URL for a local path, so <img>/<video>/<audio>/<embed> can load it. */
  mediaUrl: (path: string): string => `fsmedia://local/${encodeURIComponent(path)}`,

  /** Open the file dialog; resolves with the folder payload or null if cancelled. */
  openDialog: (): Promise<OpenPayload | null> => ipcRenderer.invoke('open:dialog'),
  /** Build a payload for a dropped/known path (drag-and-drop). */
  openPath: (path: string): Promise<OpenPayload | null> => ipcRenderer.invoke('open:path', path),
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
  onFullscreen: (cb: (on: boolean) => void): (() => void) => {
    const listener = (_: unknown, on: boolean): void => cb(on)
    ipcRenderer.on('window:fullscreen', listener)
    return () => ipcRenderer.removeListener('window:fullscreen', listener)
  }
}

contextBridge.exposeInMainWorld('prism', api)

export type PrismApi = typeof api
