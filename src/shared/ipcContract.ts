/**
 * PRISM'S IPC CONTRACT: what each CALL channel carries and what it answers
 * (#538 item 27). `channels.ts` shares the NAMES; this file shares the
 * SHAPES, so the preload's `invoke`/`send` and main's `handle`/`on` are
 * checked against one map and a change on one side is a type error on the
 * other, not a call that fails at run time.
 *
 * Migrated area by area. A channel NOT listed here is still called and
 * handled with the plain `ipcRenderer`/`ipcMain`; moving it in means adding
 * its row and switching its two ends to the typed wrappers (the preload's
 * `invoke`/`send`, main's `ipc/typed.ts`). Done so far: the app version and
 * pickers (`open.ts`), the link opener (`links.ts`), the tile pictures
 * (`thumbs.ts`).
 *
 * `args` are what the PAGE sends. A main handler may declare its parameters
 * wider (`unknown`), which is how it stays a validator of what it was handed.
 */
import { CALL } from './channels'
import type { ThumbWant, ThumbsWantReply } from './thumbTypes'

/** One channel's arguments (as the page sends them) and its answer. */
export interface Shape<Args extends unknown[], Result> {
  args: Args
  result: Result
}

/** `ipcRenderer.invoke` / `ipcMain.handle`: the page awaits an answer. */
export interface InvokeContract {
  [CALL.appVersion]: Shape<[], string>
  [CALL.e2eSlowIpc]: Shape<[], boolean>
  [CALL.dialogPickFolder]: Shape<[], string | null>
  [CALL.dialogPickFiles]: Shape<[], string[]>
  [CALL.thumbsWant]: Shape<[tabId: string, gen: number, items: ThumbWant[]], ThumbsWantReply>
}

/** `ipcRenderer.send` / `ipcMain.on`: fire and forget. */
export interface SendContract {
  [CALL.openExternal]: Shape<[url: string], void>
  [CALL.thumbsCancel]: Shape<[tabId: string], void>
  [CALL.thumbsFilm]: Shape<[playing: boolean], void>
}

export type InvokeChannel = keyof InvokeContract
export type SendChannel = keyof SendContract