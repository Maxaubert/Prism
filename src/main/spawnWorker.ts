import { Worker } from 'worker_threads'

/**
 * MAIN NEVER STARTS A PROCESS ITSELF (2026-10-27). Starting a process is
 * synchronous on the thread that starts it (libuv's uv_spawn is
 * CreateProcessW), and now and then that took main's whole event loop, and
 * with it every window, for seconds: #351 measured 2.95 to 3.25 s with only
 * the drive query in flight, and moving that one query to a worker ended
 * those lags in the diagnostics log. The startup freeze (4 to 5 s, about ten
 * seconds in, nothing in flight) lines up with the burst of reg.exe,
 * PowerShell and es.exe calls main made then.
 *
 * So every short-lived process main wants goes through this one worker
 * thread, which pays the wait on its own thread; main only hears the answer.
 * `execFile` here has node's callback shape, so a call site changes its
 * import and nothing else. `spawnCalls.test.ts` keeps `child_process` out of
 * the rest of main; the few that stream or detach say why on the line.
 */

export interface ExecOptions {
  timeout?: number
  maxBuffer?: number
  windowsHide?: boolean
  windowsVerbatimArguments?: boolean
  cwd?: string
  /** 'buffer' hands stdout back as a Buffer. */
  encoding?: 'buffer' | 'utf8'
  signal?: AbortSignal
  /** Written to stdin, which is then closed. Stdin is ALWAYS closed: a
   *  PowerShell left with an open stdin can wait on it forever. */
  input?: string
}

export type ExecError = Error & { code?: string | number; killed?: boolean; signal?: string | null }
export type ExecCallback = (error: ExecError | null, stdout: string, stderr: string) => void
export type ExecBufferCallback = (error: ExecError | null, stdout: Buffer, stderr: string) => void

interface Reply {
  id: number
  err: { message: string; code?: string | number; killed?: boolean; signal?: string | null } | null
  stdout: string | Uint8Array
  stderr: string | Uint8Array
}

const WORKER = `
const { parentPort } = require('worker_threads')
const { execFile, spawn } = require('child_process')
const kids = new Map()
const failure = (e) => ({ message: String((e && e.message) || e), code: e && e.code, killed: !!(e && e.killed), signal: (e && e.signal) || null })
parentPort.on('message', (m) => {
  if (m.cancel !== undefined) {
    const c = kids.get(m.cancel)
    if (c) c.kill()
    return
  }
  if (m.launch) {
    try {
      const child = spawn(m.exe, m.args, { detached: true, stdio: 'ignore', windowsHide: !!m.opts.windowsHide, cwd: m.opts.cwd })
      child.once('error', (e) => parentPort.postMessage({ id: m.id, err: failure(e), stdout: '', stderr: '' }))
      child.once('spawn', () => {
        child.unref()
        parentPort.postMessage({ id: m.id, err: null, stdout: String(child.pid ?? ''), stderr: '' })
      })
    } catch (e) {
      parentPort.postMessage({ id: m.id, err: failure(e), stdout: '', stderr: '' })
    }
    return
  }
  let child
  try {
    child = execFile(m.exe, m.args, m.opts, (err, stdout, stderr) => {
      kids.delete(m.id)
      // Bytes are MOVED to main, never copied: a decoded image can be 256 MB.
      let move = []
      if (Buffer.isBuffer(stdout)) {
        const own = new Uint8Array(stdout.byteLength)
        own.set(stdout)
        stdout = own
        move = [own.buffer]
      }
      parentPort.postMessage({ id: m.id, err: err ? failure(err) : null, stdout, stderr }, move)
    })
  } catch (e) {
    parentPort.postMessage({ id: m.id, err: failure(e), stdout: '', stderr: '' })
    return
  }
  kids.set(m.id, child)
  if (child.stdin) {
    child.stdin.on('error', () => {})
    child.stdin.end(m.input == null ? undefined : m.input, 'utf8')
  }
})
`

/** A worker and the calls waiting on IT: a dead worker answers only its own
 *  (its 'error' and 'exit' both fire, the second after the next one exists). */
interface Live {
  w: Worker
  pending: Map<number, (r: Reply) => void>
}

let worker: Live | null = null
let nextId = 1

function theWorker(): Live {
  if (worker) return worker
  const w = new Worker(WORKER, { eval: true })
  // An idle worker never holds the app open on quit.
  w.unref()
  const live: Live = { w, pending: new Map() }
  const { pending } = live
  const lost = (message: string): void => {
    if (worker === live) worker = null
    for (const [id, answer] of pending) answer({ id, err: { message }, stdout: '', stderr: '' })
    pending.clear()
  }
  w.on('message', (r: Reply) => {
    const answer = pending.get(r.id)
    pending.delete(r.id)
    answer?.(r)
  })
  w.on('error', (e: Error) => lost(String(e?.message ?? e)))
  w.on('exit', () => lost('the process worker stopped'))
  worker = live
  return live
}

const text = (v: string | Uint8Array | undefined): string =>
  typeof v === 'string' ? v : v ? Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('utf8') : ''

const bytes = (v: string | Uint8Array | undefined): Buffer =>
  typeof v === 'string' ? Buffer.from(v, 'utf8') : v ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : Buffer.alloc(0)

function errorOf(e: NonNullable<Reply['err']>): ExecError {
  return Object.assign(new Error(e.message), { code: e.code, killed: e.killed, signal: e.signal ?? null })
}

/** node's `execFile`, run from the process worker. The handle's `kill` stops
 *  the process (as does `signal`); the callback still answers once. */
export function execFile(
  exe: string,
  args: readonly string[],
  options: ExecOptions & { encoding: 'buffer' },
  callback: ExecBufferCallback
): { kill(): void }
export function execFile(
  exe: string,
  args: readonly string[],
  options: ExecOptions,
  callback: ExecCallback
): { kill(): void }
export function execFile(
  exe: string,
  args: readonly string[],
  options: ExecOptions,
  callback: ExecCallback | ExecBufferCallback
): { kill(): void } {
  const { signal, input, ...opts } = options
  const asBuffer = opts.encoding === 'buffer'
  let done = false
  const answer = (r: Reply): void => {
    if (done) return
    done = true
    signal?.removeEventListener('abort', abort)
    const err = r.err ? errorOf(r.err) : null
    if (asBuffer) (callback as ExecBufferCallback)(err, bytes(r.stdout), text(r.stderr))
    else (callback as ExecCallback)(err, text(r.stdout), text(r.stderr))
  }
  const id = nextId++
  let live: Live | null = null
  const kill = (): void => {
    if (!done) live?.w.postMessage({ cancel: id })
  }
  const abort = (): void => {
    kill()
    answer({ id, err: { message: 'The operation was aborted', code: 'ABORT_ERR' }, stdout: '', stderr: '' })
  }
  if (signal?.aborted) {
    queueMicrotask(abort)
    return { kill }
  }
  try {
    live = theWorker()
    live.pending.set(id, answer)
    live.w.postMessage({ id, exe, args: [...args], opts: { windowsHide: true, ...opts }, input })
  } catch (e) {
    live?.pending.delete(id)
    queueMicrotask(() => answer({ id, err: { message: String((e as Error)?.message ?? e) }, stdout: '', stderr: '' }))
    return { kill }
  }
  signal?.addEventListener('abort', abort, { once: true })
  return { kill }
}

/** The promise form: stdout and stderr, or the error with both attached. */
export function run(
  exe: string,
  args: readonly string[],
  options: ExecOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(exe, args, { ...options, encoding: 'utf8' }, (err, stdout, stderr) =>
      err ? reject(Object.assign(err, { stdout, stderr })) : resolve({ stdout, stderr })
    )
  })
}

/** Start a program detached and forget it (an app from "Open with", the
 *  indexer, Explorer): the pid once it is running, or the error. */
export function launch(
  exe: string,
  args: readonly string[],
  options: { windowsHide?: boolean; cwd?: string } = {}
): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const id = nextId++
    let live: Live | null = null
    try {
      live = theWorker()
      live.pending.set(id, (r) => (r.err ? reject(errorOf(r.err)) : resolve(Number(text(r.stdout)) || undefined)))
      live.w.postMessage({ id, launch: true, exe, args: [...args], opts: options })
    } catch (e) {
      live?.pending.delete(id)
      reject(e as Error)
    }
  })
}
