import { createConnection, type Socket } from 'net'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function winERequest(argv: readonly string[]): string | null {
  const value = argv.find((arg) => arg.startsWith('--win-e='))?.slice('--win-e='.length)
  return value && UUID.test(value) ? value : null
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
  const socket = createConnection(`\\\\.\\pipe\\PrismWinE.${id}`)
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

/** A request can arrive before startup restore or renderer subscription. */
export function createWinERequests(
  dispatch: (id: string) => void,
  acknowledge: (id: string) => Promise<void> = acknowledgeWinE,
  announce: (id: string) => void = announceWinE
): {
  enqueue: (id: string) => void
  listen: () => void
  restored: () => void
  reload: () => void
  ready: (id: string) => void
} {
  let listening = false
  let restored = false
  const pending = new Map<string, { sent: boolean; timer: ReturnType<typeof setTimeout> }>()
  const flush = (): void => {
    if (!listening || !restored) return
    for (const [id, request] of pending)
      if (!request.sent) {
        request.sent = true
        dispatch(id)
      }
  }
  return {
    enqueue(id) {
      if (!UUID.test(id) || pending.has(id) || pending.size >= 8) return
      // "started" goes to the helper now; the ready line when the browser shows.
      announce(id)
      // Kept as long as the helper's patience, which a cold start can need.
      const timer = setTimeout(() => pending.delete(id), 45000)
      timer.unref()
      pending.set(id, { sent: false, timer })
      flush()
    },
    listen() {
      listening = true
      flush()
    },
    restored() {
      restored = true
      flush()
    },
    reload() {
      listening = false
      restored = false
      for (const request of pending.values()) request.sent = false
    },
    ready(id) {
      const request = pending.get(id)
      if (!request?.sent || !listening || !restored) return
      clearTimeout(request.timer)
      pending.delete(id)
      void acknowledge(id).catch(() => {
        /* No reply lets the helper fall back. */
      })
    }
  }
}
