import { DGCH } from '../shared/channels'
import type { DiagLog } from './diagLog'
import type { IpcMainLike } from './ipcLike'

/**
 * THE MAIN HALF OF THE DIAGNOSTICS BRIDGE (#140), for both hosts. The preload
 * half is `core/preload/diagApi`; `startDiagnostics` registers this.
 *
 * The page's lines arrive here in batches and are held to the page's own
 * kinds: a renderer cannot write a `session` or a `main-lag`, so a line's
 * source is always true. The folder Open folder opens is the log's own,
 * never a path the page sends.
 */

export interface DiagIpcDeps {
  ipcMain: IpcMainLike
  log: DiagLog
  /** Each page's beat and stalls, named by its sender's id when the event has
   *  one (several windows in one process, 2026-10-29). */
  watch?: { beat(page?: number): void; pageStall(startAt: number, ms: number, page?: number): void }
  /** Show a folder in Explorer. Under --e2e the host records instead. */
  openFolder(dir: string): void
  wall?: () => number
}

/** The kinds a page may write. An app's own timing kinds end in `-slow`
 *  (Prism's `sort-slow`, `guard-slow`), written through `diag.time`. */
const PAGE_KINDS = new Set([
  'page-stall',
  'page-task',
  'page-error',
  'page-rejection',
  'crumb',
  // The agent indicator's record (#152, `core/renderer/lib/agentDiag`).
  'agent-hook',
  'agent-title',
  'agent-mark',
  'agent-restore'
])
const KIND = /^[a-z][a-z-]{1,30}$/
/** Lines only Detailed logging keeps. */
const VERBOSE_ONLY = new Set(['page-task'])
const MAX_BATCH = 200
const DAY = 86_400_000

/** One line of a page batch as it will be written, or null to drop it. */
export function pageLine(
  raw: unknown,
  wallNow: number,
  verbose: boolean
): { k: string; at: number; fields: Record<string, unknown> } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const { k, at, often, ...fields } = raw as Record<string, unknown>
  if (typeof k !== 'string' || !KIND.test(k)) return null
  if (!PAGE_KINDS.has(k) && !k.endsWith('-slow')) return null
  if (!verbose && (VERBOSE_ONLY.has(k) || often === true)) return null
  const when = typeof at === 'number' && Number.isFinite(at) && Math.abs(wallNow - at) < DAY ? at : wallNow
  return { k, at: when, fields }
}

/** The page an IPC event came from: its sender's webContents id, if it says. */
function pageOf(e: unknown): number | undefined {
  const id = (e as { sender?: { id?: unknown } } | null)?.sender?.id
  return typeof id === 'number' ? id : undefined
}

export function registerDiagIpc(deps: DiagIpcDeps): void {
  const { ipcMain, log } = deps
  const wall = deps.wall ?? Date.now

  ipcMain.on(DGCH.batch, (e: unknown, batch: unknown) => {
    if (!Array.isArray(batch)) return
    const verbose = log.verbose()
    const page = pageOf(e)
    for (const raw of batch.slice(0, MAX_BATCH)) {
      const line = pageLine(raw, wall(), verbose)
      if (!line) continue
      log.writeAt('page', line.k, line.at, line.fields)
      if (line.k === 'page-stall' && typeof line.fields.ms === 'number') {
        if (page === undefined) deps.watch?.pageStall(line.at, line.fields.ms)
        else deps.watch?.pageStall(line.at, line.fields.ms, page)
      }
    }
  })

  ipcMain.on(DGCH.beat, (e: unknown) => {
    const page = pageOf(e)
    if (page === undefined) deps.watch?.beat()
    else deps.watch?.beat(page)
  })

  ipcMain.handle(DGCH.info, () => ({ verbose: log.verbose(), dir: log.dir }))

  ipcMain.handle(DGCH.setVerbose, (_e: unknown, on: unknown) => {
    if (typeof on === 'boolean') log.setVerbose(on)
    return log.verbose()
  })

  ipcMain.on(DGCH.openFolder, () => {
    if (log.dir) deps.openFolder(log.dir)
  })

  ipcMain.on(DGCH.mark, (_e: unknown, note: unknown) => {
    log.write('page', 'mark', { note: typeof note === 'string' && note.trim() ? note.trim() : null })
  })
}

/** The Document-Policy that lets main read the page's JavaScript stack
 *  (`collectJavaScriptCallStack`). MEASURED on Electron 43: without it the
 *  frame answers "Website owner has not opted in"; with it, served through
 *  `session.webRequest.onHeadersReceived`, the stack came back for a
 *  `file://` page and a dev server's `http://` page alike. */
export const STACK_POLICY = 'include-js-call-stacks-in-crash-reports'

/** A response's headers with the stack policy added, for the host's
 *  `onHeadersReceived` (the core never touches a session itself). */
export function withStackPolicy(headers: Record<string, string[] | string> | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  let key: string | null = null
  for (const [k, v] of Object.entries(headers ?? {})) {
    out[k] = Array.isArray(v) ? [...v] : [v]
    if (k.toLowerCase() === 'document-policy') key = k
  }
  if (!key) out['Document-Policy'] = [STACK_POLICY]
  else if (!out[key].join(',').includes(STACK_POLICY)) out[key] = [[...out[key], STACK_POLICY].join(', ')]
  return out
}
