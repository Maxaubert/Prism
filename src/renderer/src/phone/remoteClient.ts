/**
 * The Remote screen's side of the wire (2026-09-07, #107): the state stream
 * in, the commands out, and the clock the phone draws between two reports.
 *
 * The stream is an `EventSource` on `GET /remote/state`, the token in the
 * query because an EventSource cannot carry a header (`apiUrl` puts it
 * there, and `tokenOf` on the server reads it). The browser's own reconnect
 * is NOT relied on: on a network error it retries at once and for ever, and
 * on a refused connection (the PC forgot this phone, the server is off) it
 * gives up for good with no way to tell the two apart. So an error closes
 * the source and this reopens it on its own clock, doubling from a second
 * to fifteen, and `onDown` says which state the screen is in. The phone's
 * commands answer with a STATUS, never a body: 204 is taken, 409 is
 * "nothing is playing on the PC", 401 is a phone the PC forgot, and 0 is a
 * fetch that never reached Prism.
 *
 * The dependencies are arguments so the whole thing runs under a fake
 * EventSource and fake timers; the defaults are the browser's own.
 */
import type { RemoteCmd, RemoteState } from '@shared/remote'
import { apiUrl } from './api'

/** The slice of EventSource this uses, so a test can stand one in. */
export interface StreamSource {
  addEventListener(type: string, listener: (e: { data?: unknown }) => void): void
  close(): void
}

export interface ClientDeps {
  open: (url: string) => StreamSource
  setTimeout: (cb: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
  fetch: (url: string, init: RequestInit) => Promise<{ status: number }>
}

const browserDeps = (): ClientDeps => ({
  open: (url) => new EventSource(url),
  setTimeout: (cb, ms) => window.setTimeout(cb, ms),
  clearTimeout: (h) => window.clearTimeout(h as number),
  fetch: (url, init) => fetch(url, init)
})

const BACKOFF_FIRST_MS = 1000
const BACKOFF_MAX_MS = 15_000

/** How long to wait before the `attempt`th reconnect: 1s, 2s, 4s, 8s, then 15s. */
export function backoff(attempt: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_FIRST_MS * 2 ** Math.max(0, attempt))
}

/**
 * A state out of one frame's data, or null for anything that is not one.
 * Only the shape is checked (the server built it from `RemoteState`); a
 * frame that is not JSON, or JSON of the wrong shape, is dropped rather than
 * drawn as a state of NaN.
 */
export function parseFrame(data: unknown): RemoteState | null {
  if (typeof data !== 'string') return null
  let v: unknown
  try {
    v = JSON.parse(data)
  } catch {
    return null
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const s = v as Record<string, unknown>
  const isNum = (k: string): boolean => typeof s[k] === 'number' && Number.isFinite(s[k])
  const isBool = (k: string): boolean => typeof s[k] === 'boolean'
  if (
    !isBool('empty') ||
    !isBool('playing') ||
    !isBool('muted') ||
    !isBool('canNext') ||
    !isBool('canPrev')
  )
    return null
  if (!isNum('cur') || !isNum('dur') || !isNum('vol') || !isNum('rate')) return null
  if (typeof s.name !== 'string') return null
  if (s.kind !== 'video' && s.kind !== 'audio' && s.kind !== '') return null
  return s as unknown as RemoteState
}

/**
 * Open the stream and keep it open. `onState` gets every state frame,
 * `onDown` says whether the phone is currently cut off from the PC (true
 * on an error, false once a connection is open). Returns the stop.
 */
export function connect(
  onState: (s: RemoteState) => void,
  onDown: (down: boolean) => void,
  deps: ClientDeps = browserDeps()
): () => void {
  let source: StreamSource | null = null
  let timer: unknown = null
  let attempt = 0
  let stopped = false

  const open = (): void => {
    if (stopped) return
    const es = deps.open(apiUrl('/remote/state'))
    source = es
    es.addEventListener('open', () => {
      if (source !== es) return
      attempt = 0
      onDown(false)
    })
    es.addEventListener('state', (e) => {
      if (source !== es) return
      const s = parseFrame(e.data)
      if (s) onState(s)
    })
    es.addEventListener('error', () => {
      if (source !== es) return
      // Closed here, not left to the browser: its own retry is either at
      // once for ever or never, and neither is what a remote wants.
      es.close()
      source = null
      onDown(true)
      const wait = backoff(attempt)
      attempt += 1
      timer = deps.setTimeout(() => {
        timer = null
        open()
      }, wait)
    })
  }
  open()
  return () => {
    stopped = true
    if (timer !== null) deps.clearTimeout(timer)
    timer = null
    source?.close()
    source = null
  }
}

/** POST one command; the answer is its status, 0 when nothing answered. */
export async function send(
  cmd: RemoteCmd,
  deps: Pick<ClientDeps, 'fetch'> = browserDeps()
): Promise<number> {
  try {
    const r = await deps.fetch(apiUrl('/remote/cmd'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cmd)
    })
    return r.status
  } catch {
    return 0
  }
}

/**
 * The clock to draw at `now` for a state received at `receivedAt`: a
 * playing clock is carried forward at the PC's rate, so the scrubber moves
 * between the PC's once-a-second reports instead of jumping, and is capped
 * at the duration; a paused clock is the report's own. It is the phone's
 * best guess at the PC's clock and is corrected by the next report, which
 * is the whole of the promise: lockstep is not.
 */
export function shownClock(s: RemoteState, receivedAt: number, now: number): number {
  if (!s.playing) return s.cur
  const ahead = Math.max(0, now - receivedAt) / 1000
  const cur = s.cur + ahead * s.rate
  return s.dur > 0 ? Math.min(cur, s.dur) : cur
}

/** What the phone says for a command's answer, or null for one that went through. */
export function noticeFor(status: number): string | null {
  if (status === 204) return null
  if (status === 409) return 'Nothing is playing on the PC'
  if (status === 401) return 'This PC forgot this phone'
  if (status === 0) return 'Could not reach Prism'
  return `Prism refused that (${status})`
}
