/** The slice of Electron's `ipcRenderer` the core's preload factories need.
 *  Its own file (2026-10-26, explorer-only strip) so diagApi does not hang off
 *  the terminal bridge in api.ts. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface IpcRendererLike {
  invoke(channel: string, ...args: any[]): Promise<any>
  send(channel: string, ...args: any[]): void
  sendSync(channel: string, ...args: any[]): any
  on(channel: string, listener: (event: any, ...args: any[]) => void): unknown
  removeListener(channel: string, listener: (event: any, ...args: any[]) => void): unknown
}
/* eslint-enable @typescript-eslint/no-explicit-any */
