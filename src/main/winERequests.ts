import { createConnection } from 'net'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function winERequest(argv: readonly string[]): string | null {
  const value = argv.find((arg) => arg.startsWith('--win-e='))?.slice('--win-e='.length)
  return value && UUID.test(value) ? value : null
}

/** Connect only to a generated local pipe, never to a path supplied by argv. */
export function acknowledgeWinE(id: string): Promise<void> {
  if (!UUID.test(id)) return Promise.resolve()
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
  acknowledge: (id: string) => Promise<void> = acknowledgeWinE
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
      const timer = setTimeout(() => pending.delete(id), 10000)
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
