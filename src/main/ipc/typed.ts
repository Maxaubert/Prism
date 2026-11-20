import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import type { InvokeChannel, InvokeContract, SendChannel, SendContract } from '@shared/ipcContract'

/**
 * Main's side of the typed IPC contract (`shared/ipcContract.ts`, #538 item
 * 27). `handle` and `on` are `ipcMain.handle` and `ipcMain.on` with the
 * channel's arguments and answer taken from the shared map, so a handler that
 * drifts from what the preload sends fails to compile. A handler may take
 * `unknown` for an argument and validate it; it may not take a narrower type.
 */
export function handle<C extends InvokeChannel>(
  channel: C,
  fn: (
    event: IpcMainInvokeEvent,
    ...args: InvokeContract[C]['args']
  ) => InvokeContract[C]['result'] | Promise<InvokeContract[C]['result']>
): void {
  ipcMain.handle(channel, fn as Parameters<typeof ipcMain.handle>[1])
}

export function on<C extends SendChannel>(
  channel: C,
  fn: (event: IpcMainEvent, ...args: SendContract[C]['args']) => void
): void {
  ipcMain.on(channel, fn as Parameters<typeof ipcMain.on>[1])
}