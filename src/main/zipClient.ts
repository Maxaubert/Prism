import { resolve } from 'path'
import type { ZipOp, ZipOps, ZipReply, ZipRequest } from './zipOps'

// main's side of the zip worker (owner, 2026-10-12, "zip editing off the main
// process"). Only TYPES come from zipOps.ts, so adm-zip never loads on main.
//
// - ONE FILE, ONE WRITER: edits of one archive run one at a time, in the
//   order they were asked for, and a read waits for the edits asked for
//   before it, so it never sees a zip half way through an earlier request.
// - KEPT WARM, NOT FOREVER: the worker forks on the first job and is killed
//   after `idleMs` with nothing pending, the HEIC worker's rule (2026-08-28).
// - A worker that exits or crashes rejects every job it held, and the next
//   job forks a fresh one.
//
// The process is injected (`fork`), so the unit tests drive this with a fake
// that runs zipOps in-process; main hands it `utilityProcess.fork`.

/** The part of Electron's UtilityProcess this uses. */
export interface ZipProc {
  postMessage(message: ZipRequest): void
  on(event: 'message', listener: (message: ZipReply) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  kill(): unknown
}

export interface ZipClientOptions {
  fork: () => ZipProc
  /** The 7-Zip main uses, sent with every job for the AES route. */
  seven?: () => string | null
  idleMs?: number
}

type Result<K extends ZipOp> = Awaited<ReturnType<ZipOps[K]>>

export interface ZipClient {
  /** A job that only reads `zipPath`. */
  read<K extends ZipOp>(
    op: K,
    zipPath: string,
    ...rest: Tail<Parameters<ZipOps[K]>>
  ): Promise<Result<K>>
  /** A job that rewrites `zipPath`: queued behind every earlier edit of it. */
  edit<K extends ZipOp>(
    op: K,
    zipPath: string,
    ...rest: Tail<Parameters<ZipOps[K]>>
  ): Promise<Result<K>>
  /** Resolves once every edit of `zipPath` asked for so far has settled. */
  settled(zipPath: string): Promise<void>
  /** Jobs posted and not yet answered (for the tests and the idle rule). */
  pending(): number
  /** Kill the worker now (quit). Pending jobs reject. */
  stop(): void
}

type Tail<T extends unknown[]> = T extends [unknown, ...infer R] ? R : never

export const ZIP_IDLE_MS = 60_000

export function createZipClient(opts: ZipClientOptions): ZipClient {
  const idleMs = opts.idleMs ?? ZIP_IDLE_MS
  let proc: ZipProc | null = null
  let seq = 0
  let idle: ReturnType<typeof setTimeout> | null = null
  const waiting = new Map<
    number,
    { proc: ZipProc; resolve: (v: unknown) => void; reject: (e: Error) => void }
  >()
  /** The last edit asked for, per archive (resolved, lower-cased path). */
  const tails = new Map<string, Promise<void>>()

  const keyOf = (p: string): string => resolve(p).toLowerCase()

  function worker(): ZipProc {
    if (proc) return proc
    const p = opts.fork()
    p.on('message', (m: ZipReply) => {
      const job = waiting.get(m.id)
      if (!job) return
      waiting.delete(m.id)
      if (m.ok) job.resolve(m.result)
      else job.reject(new Error(m.error))
    })
    p.on('exit', () => {
      if (proc === p) proc = null
      for (const [id, job] of waiting) {
        if (job.proc !== p) continue
        waiting.delete(id)
        job.reject(new Error('zip worker exited'))
      }
    })
    proc = p
    return p
  }

  function keepWarm(): void {
    if (idle) clearTimeout(idle)
    idle = setTimeout(() => {
      idle = null
      if (waiting.size) return keepWarm() // still busy; ask again later
      const p = proc
      proc = null
      p?.kill()
    }, idleMs)
    // A timer that only exists to kill an idle worker never keeps the app up.
    idle.unref?.()
  }

  function post(op: ZipOp, args: unknown[]): Promise<unknown> {
    const id = ++seq
    const job = new Promise<unknown>((res, rej) => {
      try {
        const p = worker()
        waiting.set(id, { proc: p, resolve: res, reject: rej })
        p.postMessage({ id, op, args, seven: opts.seven?.() ?? null })
      } catch (err) {
        waiting.delete(id)
        rej(err instanceof Error ? err : new Error(String(err)))
      }
    })
    // In a finally, the HEIC lesson: a failed job must not leave the worker
    // resident for the life of the app (2026-08-28).
    return job.finally(keepWarm)
  }

  return {
    async read(op, zipPath, ...rest) {
      await (tails.get(keyOf(zipPath)) ?? Promise.resolve())
      return post(op, [zipPath, ...rest]) as Promise<never>
    },
    edit(op, zipPath, ...rest) {
      const key = keyOf(zipPath)
      const before = tails.get(key) ?? Promise.resolve()
      const run = before.then(() => post(op, [zipPath, ...rest]))
      const tail = run.then(
        () => undefined,
        () => undefined
      )
      tails.set(key, tail)
      void tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key)
      })
      return run as Promise<never>
    },
    settled(zipPath) {
      return tails.get(keyOf(zipPath)) ?? Promise.resolve()
    },
    pending: () => waiting.size,
    stop() {
      if (idle) clearTimeout(idle)
      idle = null
      const p = proc
      p?.kill()
    }
  }
}
