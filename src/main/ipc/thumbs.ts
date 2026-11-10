import { cpus } from 'os'
import { ipcMain } from 'electron'
import { CALL, PUSH } from '@shared/channels'
import type { ThumbsWantReply } from '@shared/thumbTypes'
import { windows } from '../appState'
import { ownsDirectly } from '../desktopAccess'
import { warmCanonical } from '../dirList'
import { createThumbsEndpoint, type Sink, type ThumbsEndpoint } from '../thumbsEndpoint'
import type { Thumbs } from '../thumbs'
import type { MainCtx } from './context'

let endpoint: ThumbsEndpoint | null = null

/** A tab closed: whatever it still waits for is dropped (browse.ts releaseTab). */
export function cancelThumbs(tabId: string): void {
  endpoint?.cancel(tabId)
}

let wants = 0
/** For the e2e: how many `thumbs:want` asks the page has made (a fast scroll must make none). */
export function thumbWantCount(): number {
  return wants
}

/** For the e2e: queue and process counts. */
export function thumbsEndpoint(): ThumbsEndpoint | null {
  return endpoint
}

/**
 * The desktop's tile pictures (Stage 2 of the zoom grid, 2026-11-09): thin glue
 * to thumbsEndpoint.ts, where the wall and the queue are. Without a bundled
 * ffmpeg (`thumbs` null) every ask is answered with nothing and no picture
 * ever arrives: the tiles keep their icons.
 */
export function registerThumbsIpc(ctx: MainCtx, thumbs: Thumbs | null): void {
  const { readable } = ctx
  const watched = new Set<number>()
  endpoint = thumbs
    ? createThumbsEndpoint({
        thumbs,
        readable,
        owns: ownsDirectly,
        warm: (paths) => warmCanonical(paths),
        cores: () => cpus().length
      })
    : null

  ipcMain.handle(CALL.thumbsWant, (e, tab: unknown, gen: unknown, items: unknown): Promise<ThumbsWantReply> | ThumbsWantReply => {
    if (!endpoint || !windows.isPrismPage(e.sender)) return { ready: {} }
    wants += 1
    const sender = e.sender
    if (!watched.has(sender.id)) {
      watched.add(sender.id)
      sender.once('destroyed', () => {
        watched.delete(sender.id)
        endpoint?.forgetSender(sender.id)
      })
    }
    const sink: Sink = {
      id: sender.id,
      alive: () => !sender.isDestroyed(),
      send: (msg) => sender.send(PUSH.thumbsReady, msg)
    }
    return endpoint.want(sink, tab, gen, items)
  })
  ipcMain.on(CALL.thumbsCancel, (_e, tab: unknown) => endpoint?.cancel(tab))
  ipcMain.on(CALL.thumbsFilm, (e, playing: unknown) => {
    if (windows.isPrismPage(e.sender)) endpoint?.film(e.sender.id, playing === true)
  })
}
