import { EventEmitter } from 'events'
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
 *
 * A child that STREAMS goes through here too (`spawnStream`, review,
 * 2026-10-28: "look for stall points"): streaming is a reason main needs the
 * stdout, not a reason main must make the CreateProcess call. The worker
 * starts it and passes each stdout chunk over (moved, not copied), and main
 * gets a small stand-in with the ChildProcess shape the callers used.
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

/** What a streaming child says, in order: spawn, out/err chunks, end, close. */
interface StreamEvent {
  id: number
  ev: 'spawn' | 'out' | 'err' | 'end' | 'error' | 'close'
  pid?: number
  chunk?: Uint8Array
  err?: NonNullable<Reply['err']>
  code?: number | null
  signal?: string | null
}

const WORKER = `
const { parentPort } = require('worker_threads')
const { execFile, spawn } = require('child_process')
const kids = new Map()
const failure = (e) => ({ message: String((e && e.message) || e), code: e && e.code, killed: !!(e && e.killed), signal: (e && e.signal) || null })
// Bytes are MOVED to main, never copied (a decoded image can be 256 MB). A
// Buffer that owns its whole ArrayBuffer (anything Buffer.concat or a pipe
// read made above node's 4 KB pool) goes as it is; only a slice of a shared
// pool is copied first, since moving the pool would take its neighbours too.
const own = (b) => {
  if (b.byteOffset === 0 && b.byteLength === b.buffer.byteLength) {
    const u = new Uint8Array(b.buffer, 0, b.byteLength)
    return [u, [b.buffer]]
  }
  const u = new Uint8Array(b.byteLength)
  u.set(b)
  return [u, [u.buffer]]
}
const stream = (m) => {
  const post = (x, move) => parentPort.postMessage(Object.assign({ id: m.id }, x), move || [])
  let child
  try {
    child = spawn(m.exe, m.args, { windowsHide: m.opts.windowsHide !== false, cwd: m.opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    post({ ev: 'error', err: failure(e) })
    post({ ev: 'close', code: null, signal: null })
    return
  }
  kids.set(m.id, child)
  child.once('spawn', () => post({ ev: 'spawn', pid: child.pid }))
  child.once('error', (e) => post({ ev: 'error', err: failure(e) }))
  child.stdout.on('data', (c) => {
    const [u, move] = own(c)
    post({ ev: 'out', chunk: u }, move)
  })
  child.stdout.on('end', () => post({ ev: 'end' }))
  // An unread pipe blocks the child: stderr is drained, and passed on only when asked.
  if (m.opts.stderr) child.stderr.on('data', (c) => { const [u, move] = own(c); post({ ev: 'err', chunk: u }, move) })
  else child.stderr.resume()
  child.once('close', (code, signal) => {
    kids.delete(m.id)
    post({ ev: 'close', code, signal })
  })
}
parentPort.on('message', (m) => {
  if (m.cancel !== undefined) {
    const c = kids.get(m.cancel)
    if (c) c.kill()
    return
  }
  if (m.pause !== undefined || m.resume !== undefined) {
    const c = kids.get(m.pause !== undefined ? m.pause : m.resume)
    if (c && c.stdout) m.pause !== undefined ? c.stdout.pause() : c.stdout.resume()
    return
  }
  if (m.stream) {
    stream(m)
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
      let move = []
      if (Buffer.isBuffer(stdout)) [stdout, move] = own(stdout)
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
  streams: Map<number, (e: StreamEvent) => void>
}

let worker: Live | null = null
let nextId = 1

function theWorker(): Live {
  if (worker) return worker
  const w = new Worker(WORKER, { eval: true })
  // An idle worker never holds the app open on quit.
  w.unref()
  const live: Live = { w, pending: new Map(), streams: new Map() }
  const { pending, streams } = live
  const lost = (message: string): void => {
    if (worker === live) worker = null
    for (const [id, answer] of pending) answer({ id, err: { message }, stdout: '', stderr: '' })
    pending.clear()
    for (const [id, tell] of [...streams]) {
      tell({ id, ev: 'error', err: { message } })
      tell({ id, ev: 'close', code: null, signal: null })
    }
    streams.clear()
  }
  w.on('message', (r: Reply | StreamEvent) => {
    if ('ev' in r) {
      streams.get(r.id)?.(r)
      if (r.ev === 'close') streams.delete(r.id)
      return
    }
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

/** One pipe of a streaming child, as main sees it: 'data' (a Buffer) and
 *  'end'. `pause` and `resume` reach the real pipe in the worker; a chunk
 *  already on its way still arrives after a pause. */
export class StreamPipe extends EventEmitter {
  constructor(private readonly flow: (on: boolean) => void) {
    super()
  }
  pause(): this {
    this.flow(false)
    return this
  }
  resume(): this {
    this.flow(true)
    return this
  }
}

/**
 * A child the worker started and streams from: the slice of ChildProcess the
 * streaming callers use (`stdout`, `stderr`, `kill`, 'spawn', 'error' and
 * 'close'), and the `Held` shape `holders` needs.
 */
export class StreamChild extends EventEmitter {
  pid: number | undefined
  exitCode: number | null = null
  killed = false
  readonly stdout: StreamPipe
  readonly stderr: StreamPipe
  constructor(private readonly post: (m: object) => void, private readonly id: number) {
    super()
    this.stdout = new StreamPipe((on) => this.post(on ? { resume: id } : { pause: id }))
    this.stderr = new StreamPipe(() => {})
  }
  kill(): boolean {
    if (this.exitCode !== null || this.killed) return false
    this.killed = true
    this.post({ cancel: this.id })
    return true
  }
}

/** Options for `spawnStream`: `stderr` passes the child's stderr on as
 *  'data' (otherwise it is drained in the worker and never crosses). */
export interface StreamOptions {
  windowsHide?: boolean
  cwd?: string
  stderr?: boolean
}

/** node's `spawn` for a child main streams from, started by the process
 *  worker so CreateProcess never runs on main's thread. Stdin is closed. */
export function spawnStream(exe: string, args: readonly string[], options: StreamOptions = {}): StreamChild {
  const id = nextId++
  let live: Live | null = null
  const child = new StreamChild((m) => live?.w.postMessage(m), id)
  const tell = (e: StreamEvent): void => {
    switch (e.ev) {
      case 'spawn':
        child.pid = e.pid
        child.emit('spawn')
        break
      case 'out':
        if (e.chunk) child.stdout.emit('data', Buffer.from(e.chunk.buffer, e.chunk.byteOffset, e.chunk.byteLength))
        break
      case 'err':
        if (e.chunk) child.stderr.emit('data', Buffer.from(e.chunk.buffer, e.chunk.byteOffset, e.chunk.byteLength))
        break
      case 'end':
        child.stdout.emit('end')
        break
      case 'error':
        if (child.listenerCount('error')) child.emit('error', errorOf(e.err ?? { message: 'failed' }))
        break
      case 'close':
        child.exitCode = e.code ?? null
        child.emit('exit', e.code ?? null, e.signal ?? null)
        child.emit('close', e.code ?? null, e.signal ?? null)
        break
    }
  }
  try {
    live = theWorker()
    live.streams.set(id, tell)
    live.w.postMessage({ id, stream: true, exe, args: [...args], opts: { windowsHide: true, ...options } })
  } catch (e) {
    const err = { message: String((e as Error)?.message ?? e) }
    queueMicrotask(() => {
      tell({ id, ev: 'error', err })
      tell({ id, ev: 'close', code: null, signal: null })
    })
  }
  return child
}
