/**
 * main's side of a worker, written once (stage 9b of the structure cleanup,
 * 2026-10-12). The HEIC decoder, the zip worker and the document worker each
 * had their own copy of the same lifecycle:
 *
 * - STARTED LAZILY: the worker forks on the first job, never at launch.
 * - ONE PENDING MAP: each job posts `{ id, ...payload }` and the reply with
 *   that id settles it (`settle` turns a reply into a value or a throw).
 * - KEPT WARM, NOT FOREVER (2026-08-28): a fork costs more than most jobs, so
 *   the worker stays between them, but after `idleMs` with nothing pending it
 *   is killed. A folder of photos browsed once used to leave a node process
 *   resident for as long as Prism was. The timer is unref'd: it only exists
 *   to kill an idle worker and never keeps the app up.
 * - A WORKER THAT EXITS rejects every job it held, and the next job starts a
 *   fresh one. A worker replaced in the meantime only rejects its own jobs.
 *
 * The process is injected (`start`), so the unit tests drive each client with
 * a fake; main hands it `utilityProcess.fork` or a worker_threads Worker.
 */

/** The part of a utility process or worker thread the pool uses. */
export interface PoolProc<Reply = unknown> {
  postMessage(message: unknown): void
  on(event: 'message', listener: (message: Reply) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  kill(): unknown
}

export interface WorkerPoolOptions<Reply extends { id: number }> {
  start: () => PoolProc<Reply>
  /** A reply to its job's answer; a throw rejects the job. */
  settle: (reply: Reply) => unknown
  /** What the jobs a dead worker held are rejected with. */
  exitError: string
  idleMs: number
}

export interface WorkerPool {
  /** Post `{ id, ...payload }` and wait for the reply with that id. */
  call<T>(payload: object): Promise<T>
  /** Jobs posted and not yet answered. */
  pending(): number
  /** Kill the worker now (quit). Its pending jobs reject on its exit. */
  stop(): void
}

export function createWorkerPool<Reply extends { id: number }>(
  opts: WorkerPoolOptions<Reply>
): WorkerPool {
  let proc: PoolProc<Reply> | null = null
  let seq = 0
  let idle: ReturnType<typeof setTimeout> | null = null
  const waiting = new Map<
    number,
    { proc: PoolProc<Reply>; resolve: (v: unknown) => void; reject: (e: Error) => void }
  >()

  function keepWarm(): void {
    if (idle) clearTimeout(idle)
    idle = setTimeout(() => {
      idle = null
      if (waiting.size) return keepWarm() // still busy; ask again later
      const p = proc
      proc = null
      p?.kill()
    }, opts.idleMs)
    idle.unref?.()
  }

  function worker(): PoolProc<Reply> {
    if (proc) return proc
    const p = opts.start()
    p.on('message', (m: Reply) => {
      const job = waiting.get(m.id)
      if (!job) return
      waiting.delete(m.id)
      try {
        job.resolve(opts.settle(m))
      } catch (err) {
        job.reject(err instanceof Error ? err : new Error(String(err)))
      }
      // On every settle, not only the happy path: a failed job used to leave
      // the HEIC worker resident for the life of the app (2026-08-28).
      keepWarm()
    })
    p.on('exit', () => {
      if (proc === p) proc = null
      for (const [id, job] of waiting) {
        if (job.proc !== p) continue
        waiting.delete(id)
        job.reject(new Error(opts.exitError))
      }
    })
    proc = p
    return p
  }

  return {
    call<T>(payload: object): Promise<T> {
      if (idle) {
        clearTimeout(idle)
        idle = null
      }
      const id = ++seq
      return new Promise<T>((res, rej) => {
        try {
          const p = worker()
          waiting.set(id, { proc: p, resolve: res as (v: unknown) => void, reject: rej })
          p.postMessage({ id, ...payload })
        } catch (err) {
          waiting.delete(id)
          rej(err instanceof Error ? err : new Error(String(err)))
          keepWarm()
        }
      })
    },
    pending: () => waiting.size,
    stop() {
      if (idle) clearTimeout(idle)
      idle = null
      proc?.kill()
    }
  }
}
