import { createConnection, type Socket } from 'net'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function winERequest(argv: readonly string[]): string | null {
  const value = argv.find((arg) => arg.startsWith('--win-e='))?.slice('--win-e='.length)
  return value && UUID.test(value) ? value : null
}

/**
 * The folder a Win+E request carries (#393). Windows' folder verb runs the
 * helper's `--folder`, which starts Prism with `--win-e=<id> --browse=<path>`:
 * the same handshake as Win+E, landing on that folder instead of Home. Only an
 * absolute Windows path; anything else is no folder, and Win+E's own place.
 */
export function browseRequest(argv: readonly string[]): string | null {
  const value = argv.find((arg) => arg.startsWith('--browse='))?.slice('--browse='.length)
  if (!value || value.length > 32767 || value.includes('\0')) return null
  return /^(?:[a-z]:\\|\\\\[^\\]+\\[^\\]+)/i.test(value) ? value : null
}

/**
 * The pipe to the helper, held open from the moment main has the request to
 * the moment the folder browser is on screen (2026-09-22, owner: after a boot
 * Win+E opened File Explorer until Prism had been run once). A cold start after
 * boot can outrun the helper's first wait, so main says "started" at once and
 * the helper then waits for the ready line as long as the pipe stays open. The
 * helper's server takes ONE connection, which is why the ready line goes down
 * this same socket rather than a new one.
 */
const held = new Map<string, Socket>()

/** Connect only to a generated local pipe, never to a path supplied by argv. */
export function announceWinE(id: string): void {
  if (!UUID.test(id) || held.has(id)) return
  // HALF-OPEN (#350). The helper's server only reads, so this end sees
  // end-of-file at once, and Node's default then closed the socket a few ms
  // after "started": the helper took the close for a dead Prism and opened
  // File Explorer as well, on every press. The write side stays open.
  const socket = createConnection({ path: `\\\\.\\pipe\\PrismWinE.${id}`, allowHalfOpen: true })
  held.set(id, socket)
  socket.on('error', () => {
    held.delete(id)
    socket.destroy()
  })
  socket.on('connect', () => socket.write(`${id} started\n`))
}

/** Connect only to a generated local pipe, never to a path supplied by argv. */
export function acknowledgeWinE(id: string): Promise<void> {
  if (!UUID.test(id)) return Promise.resolve()
  const open = held.get(id)
  if (open && !open.destroyed) {
    held.delete(id)
    return new Promise((resolve) => {
      const done = (): void => {
        open.destroy()
        resolve()
      }
      open.setTimeout(1500, done)
      open.end(`${id}\n`, done)
    })
  }
  return new Promise((resolve) => {
    const socket = createConnection(`\\\\.\\pipe\\PrismWinE.${id}`)
    const done = (): void => {
      socket.destroy()
      resolve()
    }
    socket.setTimeout(1500, done)
    socket.on('error', done)
    socket.on('connect', () => socket.end(`${id}\n`, done))
  })
}

/** The host of a cold start's request: the session's FIRST window (it is
 *  not made yet when the request is queued). */
export const WIN_E_FIRST = 'first'

/** The host a window's page answers for: the first window the cold start's
 *  requests, a window opened for a request its own; none for any other. */
export function winEHostOf(r: { first: boolean; winE: string | null } | undefined): string | null {
  if (!r) return null
  return r.first ? WIN_E_FIRST : r.winE
}

/**
 * A request can arrive before its window has restored or its page subscribed.
 *
 * EACH REQUEST NAMES ITS WINDOW (tab tear-off step 2, 2026-10-29). A cold
 * start's lands in the session's first window (`WIN_E_FIRST`); a Win+E or a
 * folder-verb open while Prism runs opens a NEW window in this process, and
 * the request is that window's alone (its host is the request's own id). So
 * listening, restored and a reload are per host: one window loading never
 * resets another's request, and only the page the request went to may answer
 * it.
 */
export function createWinERequests(
  dispatch: (id: string, host: string) => void,
  acknowledge: (id: string) => Promise<void> = acknowledgeWinE,
  announce: (id: string) => void = announceWinE
): {
  /** False for a token that is invalid, already pending, or one too many:
   *  a retransmitted token must never open a second window. */
  enqueue: (id: string, host?: string) => boolean
  listen: (host?: string) => void
  restored: (host?: string) => void
  reload: (host?: string) => void
  ready: (id: string, host?: string) => void
  /** The host's window has gone: its state goes (a request expires on its own). */
  forget: (host: string) => void
} {
  const hosts = new Map<string, { listening: boolean; restored: boolean }>()
  const hostState = (host: string): { listening: boolean; restored: boolean } => {
    let h = hosts.get(host)
    if (!h) hosts.set(host, (h = { listening: false, restored: false }))
    return h
  }
  const live = (host: string): boolean => {
    const h = hosts.get(host)
    return !!h && h.listening && h.restored
  }
  const pending = new Map<string, { host: string; sent: boolean; timer: ReturnType<typeof setTimeout> }>()
  const flush = (): void => {
    for (const [id, request] of pending)
      if (!request.sent && live(request.host)) {
        request.sent = true
        dispatch(id, request.host)
      }
  }
  return {
    enqueue(id, host = WIN_E_FIRST) {
      if (!UUID.test(id) || pending.has(id) || pending.size >= 8) return false
      // "started" goes to the helper now; the ready line when the browser shows.
      announce(id)
      // Kept as long as the helper's patience, which a cold start can need.
      const timer = setTimeout(() => pending.delete(id), 45000)
      timer.unref()
      pending.set(id, { host, sent: false, timer })
      flush()
      return true
    },
    listen(host = WIN_E_FIRST) {
      hostState(host).listening = true
      flush()
    },
    restored(host = WIN_E_FIRST) {
      hostState(host).restored = true
      flush()
    },
    reload(host = WIN_E_FIRST) {
      const h = hostState(host)
      h.listening = false
      h.restored = false
      for (const request of pending.values()) if (request.host === host) request.sent = false
    },
    ready(id, host = WIN_E_FIRST) {
      const request = pending.get(id)
      if (!request?.sent || request.host !== host || !live(host)) return
      clearTimeout(request.timer)
      pending.delete(id)
      void acknowledge(id).catch(() => {
        /* No reply lets the helper fall back. */
      })
    },
    forget(host) {
      hosts.delete(host)
    }
  }
}
