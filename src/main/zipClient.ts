import { resolve } from 'path'
import type { ZipOp, ZipOps, ZipReply, ZipRequest } from './zipOps'
import { createWorkerPool } from './workerClient'

// main's side of the zip worker (owner, 2026-10-12, "zip editing off the main
// process"). Only TYPES come from zipOps.ts, so this file brings none of the
// worker's edits onto main. adm-zip itself DOES load on main, through
// archive.ts: the reads that parse a Buffer already read with fs/promises
// (the Explorer's listing, a member unpacked, an extraction out) run there.
//
// - ONE FILE, ONE WRITER: edits of one archive run one at a time, in the
//   order they were asked for, and a read waits for the edits asked for
//   before it, so it never sees a zip half way through an earlier request.
// - KEPT WARM, NOT FOREVER, and a worker that exits rejects every job it
//   held: the shared lifecycle in workerClient.ts.
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
  const pool = createWorkerPool<ZipReply>({
    start: opts.fork,
    settle: (m) => {
      if (m.ok) return m.result
      throw new Error(m.error)
    },
    exitError: 'zip worker exited',
    idleMs: opts.idleMs ?? ZIP_IDLE_MS
  })
  /** The last edit asked for, per archive (resolved, lower-cased path). */
  const tails = new Map<string, Promise<void>>()

  const keyOf = (p: string): string => resolve(p).toLowerCase()

  const post = (op: ZipOp, args: unknown[]): Promise<unknown> =>
    pool.call({ op, args, seven: opts.seven?.() ?? null })

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
    pending: pool.pending,
    stop: pool.stop
  }
}
