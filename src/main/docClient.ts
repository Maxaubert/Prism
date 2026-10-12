import { join } from 'path'
import { Worker } from 'worker_threads'
import { createWorkerPool } from './workerClient'

/**
 * DOCUMENTS ARE CONVERTED OFF MAIN (2026-10-12; owner, "handle this", after e2e
 * runs showed main freezing for seconds). The lag profiler (lagProfiler.ts)
 * caught the first .docx of a session holding main for 2.2 s, nearly all of it
 * Node's module loader reading mammoth's files one by one (`require` is
 * synchronous file reads, and a cold file is opened and scanned), and the
 * first sanitise holding it for 0.4 to 1.1 s loading the unified/rehype ESM
 * tree the same way. The conversion itself (mammoth, xlsx, adm-zip over a
 * whole book) is CPU and synchronous zip reads on top. All of it now runs on
 * one worker thread (docWorker.ts): main posts a path and hears the sanitised
 * HTML back.
 *
 * The worker starts with the first document and goes after a minute with
 * nothing to do (it holds every converter in memory); it is unref'd, so it
 * never holds a quit. A worker that dies fails the calls it had (the viewer
 * says the document could not be opened) and the next document starts a new one.
 */

export const DOC_WORKER_IDLE_MS = 60_000

/** The slice of a worker_threads Worker the client uses. */
export interface WorkerLike {
  postMessage(m: unknown): void
  on(event: string, fn: (m?: unknown) => void): unknown
  unref(): void
  terminate(): unknown
}

interface Reply {
  id: number
  html?: string | null
  error?: string
}

export interface DocClient {
  /** The document's sanitised HTML body, null when it is not one; rejects
   *  when the conversion failed. */
  html(path: string): Promise<string | null>
}

export function createDocClient(
  start: () => WorkerLike = () => new Worker(join(__dirname, 'docWorker.js')),
  idleMs = DOC_WORKER_IDLE_MS
): DocClient {
  // The lifecycle is workerClient.ts's; a worker thread is adapted to it:
  // unref'd so it never holds a quit, terminated rather than killed, and an
  // 'error' counts as the worker going.
  const pool = createWorkerPool<Reply>({
    start: () => {
      const w = start()
      w.unref()
      return {
        postMessage: (m) => w.postMessage(m),
        on: (event: string, fn: (m: never) => void) => {
          const listener = fn as (m?: unknown) => void
          if (event === 'exit') w.on('error', () => listener(1))
          return w.on(event, listener)
        },
        kill: () => w.terminate()
      }
    },
    settle: (r) => {
      if (typeof r.error === 'string') throw new Error(r.error)
      return r.html ?? null
    },
    exitError: 'the document worker stopped',
    idleMs
  })
  return { html: (path) => pool.call<string | null>({ path }) }
}
