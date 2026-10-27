/* The slice of Electron's `ipcMain` the core's registrars need. Its listener
 * types are written against Electron's own event classes, which the core does
 * not import, so the arguments are typed at each handler instead. Its own file
 * (2026-10-26, explorer-only strip) so the diagnostics registrars do not hang
 * off the terminal bridge in ipc.ts. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface IpcMainLike {
  handle(channel: string, listener: (event: any, ...args: any[]) => unknown): unknown
  on(channel: string, listener: (event: any, ...args: any[]) => void): unknown
}
/* eslint-enable @typescript-eslint/no-explicit-any */
