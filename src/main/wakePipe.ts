import { createHash } from 'crypto'
import { createServer, type Server } from 'net'
import { resolve } from 'path'
import { browseRequest, winERequest } from './winERequests'

/**
 * THE HOTKEY REACHES A RUNNING PRISM WITHOUT A SECOND PROCESS (owner,
 * 2026-11-06: "a state that helps it launch a lot faster"). The Win+E helper
 * started a whole Prism.exe for every press, only for it to find the lock
 * held, hand its arguments over and exit: Electron's start, the app's modules
 * and their set-up, every time, and on a cold disk the 3.77 s the audit could
 * not see into. A running Prism (a window open, or in standby) listens on a
 * pipe named for its profile; the helper tries it first and starts a process
 * only when no one answers.
 *
 * One JSON line in (`{"winE": id, "browse"?: folder}`), `ok` or `no` back.
 * The request is exactly what `--win-e=<id> --browse=<folder>` would carry,
 * held to the same checks (`winERequest`, `browseRequest`); the helper's own
 * pipe for that id still carries "started" and the ready line.
 */

/** The pipe for a profile folder: the helper computes the same name
 *  (PrismShortcut.cs `Launcher.WakePipe`; a shared test vector holds both). */
export function wakePipeName(profile: string): string {
  const norm = resolve(profile).replace(/[\\/]+$/, '').toLowerCase()
  return `\\\\.\\pipe\\PrismWake.${createHash('sha256').update(norm, 'utf8').digest('hex').slice(0, 24)}`
}

/** A request line as the argv a second launch would have carried, or null. */
export function wakeArgv(line: string, exe: string): string[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const { winE, browse } = parsed as { winE?: unknown; browse?: unknown }
  if (typeof winE !== 'string') return null
  const argv = [exe, `--win-e=${winE}`, ...(typeof browse === 'string' ? [`--browse=${browse}`] : [])]
  if (!winERequest(argv)) return null
  // A folder that is not one is refused whole, never dropped to a plain Win+E.
  if (typeof browse === 'string' && !browseRequest(argv)) return null
  return argv
}

/** The longest request line taken. */
const MAX_LINE = 33_000

export function startWakePipe(deps: {
  name: string
  exe: string
  /** The request, as `second-instance` would have had it; false refuses it. */
  onRequest(argv: string[]): boolean
  log?(fields: Record<string, unknown>): void
}): Server {
  const server = createServer((socket) => {
    let text = ''
    let done = false
    const answer = (ok: boolean): void => {
      if (done) return
      done = true
      socket.end(ok ? 'ok\n' : 'no\n')
    }
    socket.setTimeout(3000, () => socket.destroy())
    socket.on('error', () => socket.destroy())
    socket.on('data', (chunk) => {
      if (done) return
      text += chunk.toString('utf8')
      const at = text.indexOf('\n')
      if (at < 0) {
        if (text.length > MAX_LINE) answer(false)
        return
      }
      const argv = wakeArgv(text.slice(0, at), deps.exe)
      if (!argv) return answer(false)
      let ok: boolean
      try {
        ok = deps.onRequest(argv)
      } catch {
        ok = false
      }
      answer(ok)
    })
  })
  server.on('error', (err) => deps.log?.({ ev: 'pipe-error', err: String((err as Error)?.message ?? err) }))
  server.listen(deps.name)
  server.unref()
  return server
}
