import { ipcMain } from 'electron'
import { CALL } from '@shared/channels'
import { isWebUrl } from 'prism-term-core/shared/webUrl'
import type { MainCtx } from './context'

/**
 * PRISM'S OWN "OPEN THIS LINK" (2026-10-26, explorer-only strip). The PDF view's
 * external links used to go through the terminal bridge's `shell:open-external`;
 * with the terminal going, they ask main directly. http(s) only, checked here
 * and again in the preload; `openLink` is the host's opener (recorded, not
 * started, under --e2e).
 */
export function registerLinkIpc(ctx: MainCtx): void {
  const { openLink } = ctx
  ipcMain.on(CALL.openExternal, (_e, url: unknown) => {
    if (isWebUrl(url)) openLink(url)
  })
}
