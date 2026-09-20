/**
 * THE RUNNING EXTRACTION, as main knows it (2026-09-19, #166).
 *
 * Owner: one window for every way of extracting, "a pop-up window that you
 * can't close, kind of like it is with WinRAR", and, asked the same day, a
 * Cancel button that stops the extraction and cleans up what was half
 * written.
 *
 * Every route that writes extracted files to a folder the user can see opens
 * a job here. The job is the ONE thing that speaks on `extract:event`
 * (`shared/extraction.ts`), so the five routes cannot grow five dialects, and
 * it is the one thing Cancel has to find: it holds the 7-Zip child while
 * there is one, and a flag the in-process adm-zip loop checks between
 * members.
 *
 * CANCEL WAITS. `kill` is TerminateProcess on Windows and returns before the
 * process's handles are gone (measured for ffmpeg in `holders.ts`, #127, and
 * 7-Zip is no different), so removing the staging folder straight after it
 * fails with EBUSY on the very file 7-Zip was writing. `cancel` resolves when
 * the child has CLOSED, and the route that owns the job removes what it made
 * only after its own await on that child has returned.
 *
 * WHAT IS REMOVED is what `Made` recorded and nothing else. A cancelled
 * extraction must never cost the user a file that was there before it
 * started, so nothing here walks a destination deleting what it finds: a
 * staging folder is ours whole (main made it with mkdtemp), a file is ours
 * when this job wrote it under a name that was free, and a folder this job
 * created goes with `rmdir`, which refuses one that still holds something.
 *
 * Pure over its inputs: a child is anything with `kill` and a `close` event,
 * and the sender and the clock are handed in, so the tests need no 7-Zip and
 * no Electron.
 */
import { mkdir, readdir, rm, rmdir } from 'fs/promises'
import { join } from 'path'
import type { ExtractEvent, ExtractFail } from '../shared/extraction'

export interface Killable {
  kill(): unknown
  once(event: 'close', fn: () => void): unknown
  /** Already gone: nothing to wait for. */
  exitCode?: number | null
}

/**
 * Progress goes out at most this often.
 *
 * With `-bb1` 7-Zip names every file it writes, and an archive of twenty
 * thousand small ones would otherwise be twenty thousand IPC messages and as
 * many renders, for a line of text nobody can read at that speed. The LAST
 * value always gets out (a trailing send), so the bar never sticks short of
 * where the work really is.
 */
export const PROGRESS_EVERY_MS = 60

type Send = (e: ExtractEvent) => void

export class ExtractJob {
  /** Set by Cancel. The adm-zip loop reads it between members, and every
   *  route reads it after its engine returns, since a killed 7-Zip looks
   *  exactly like a failed one. */
  cancelled = false
  private child: Killable | null = null
  private ended = false
  private lastSent = 0
  private pending: { pct: number | null; file: string } | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private lastPct: number | null = null
  private settle!: () => void
  /** Resolves when `end` has been sent, which is after the clean-up. */
  readonly finished: Promise<void> = new Promise((r) => (this.settle = r))

  constructor(
    readonly id: string,
    private readonly send: Send,
    private readonly now: () => number = Date.now,
    /** Told the moment the job ends, in the same turn: the register must be
     *  free before anything that was waiting on the end can ask it again. */
    private readonly onEnd?: () => void
  ) {}

  /** The 7-Zip process doing the work, for as long as it lives. A Cancel
   *  that arrived before the spawn is honoured here, at the first moment
   *  there is something to stop. */
  attach(child: Killable): void {
    this.child = child
    child.once('close', () => {
      if (this.child === child) this.child = null
    })
    if (this.cancelled) child.kill()
  }

  progress(pct: number | null, file: string | null): void {
    if (this.ended) return
    // A message with no percentage in it (a bare file name) keeps the last.
    if (pct !== null) this.lastPct = pct
    this.pending = { pct: pct ?? this.lastPct, file: file ?? this.pending?.file ?? '' }
    const wait = this.lastSent + PROGRESS_EVERY_MS - this.now()
    if (wait <= 0) return this.flush()
    if (!this.timer) this.timer = setTimeout(() => this.flush(), wait)
  }

  private flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.pending || this.ended) return
    this.send({ type: 'progress', id: this.id, ...this.pending })
    this.pending = null
    this.lastSent = this.now()
  }

  /** Stop the work and wait until the process is really gone (bounded, so a
   *  child that will not die cannot hold the window up for ever). */
  async cancel(timeoutMs = 8000): Promise<void> {
    this.cancelled = true
    const child = this.child
    if (!child) return
    if (child.exitCode !== undefined && child.exitCode !== null) return
    await Promise.race([
      new Promise<void>((done) => {
        child.once('close', () => done())
        child.kill()
      }),
      new Promise<void>((r) => setTimeout(r, timeoutMs).unref?.())
    ])
  }

  /** The last word on this job. Once, however many paths reach it. */
  end(result: 'done' | 'cancelled' | 'failed', reason?: ExtractFail, message?: string): void {
    if (this.ended) return
    // What is still queued is dropped: on success the window fills its own
    // bar, and on the other two a late percentage would be noise.
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pending = null
    this.ended = true
    this.send({
      type: 'end',
      id: this.id,
      result,
      ...(reason ? { reason } : {}),
      ...(message ? { message } : {})
    })
    this.onEnd?.()
    this.settle()
  }
}

/**
 * The register: ONE visible extraction at a time.
 *
 * The window is modal and the app behind it is inert, so a second cannot be
 * started from the UI while one runs. Refusing it here as well means the
 * rule does not depend on the renderer keeping its side of it.
 */
export class ExtractJobs {
  private current: ExtractJob | null = null
  private seq = 0

  constructor(
    private readonly send: Send,
    private readonly now: () => number = Date.now
  ) {}

  /** Open a job and tell the window. Null while another is running. */
  begin(info: { archive: string; dest: string; asksPassword?: boolean }): ExtractJob | null {
    if (this.current) return null
    this.seq += 1
    const job: ExtractJob = new ExtractJob(`extract-${this.seq}`, this.send, this.now, () => {
      if (this.current === job) this.current = null
    })
    this.current = job
    this.send({
      type: 'start',
      id: job.id,
      archive: info.archive,
      dest: info.dest,
      ...(info.asksPassword ? { asksPassword: true } : {})
    })
    return job
  }

  running(): ExtractJob | null {
    return this.current
  }

  /**
   * The Cancel button. Resolves once the job has ENDED, which is after its
   * route has removed what it made, so whoever asked can rely on the disk
   * being as it was. False when there is no such job (it finished first).
   */
  async cancel(id: string): Promise<boolean> {
    const job = this.current
    if (!job || job.id !== id) return false
    await job.cancel()
    await job.finished
    return true
  }

  /** The app is going: no orphaned 7-Zip left writing into somebody's
   *  folder. Nothing is awaited, because nothing can be at that point. */
  killAll(): void {
    void this.current?.cancel(0)
  }
}

/**
 * What one extraction created on disk, so a Cancel can take back exactly
 * that.
 */
export class Made {
  private readonly trees: string[] = []
  private readonly files: string[] = []
  private readonly dirs: string[] = []

  /** A folder that is this job's WHOLE: a staging folder from mkdtemp, or a
   *  landing folder whose name was free. Removed with everything in it. */
  tree(path: string): void {
    this.trees.push(path)
  }

  /** One file this job wrote, under a name that did not exist. */
  file(path: string): void {
    this.files.push(path)
  }

  /** `mkdir -p`, remembering the TOPMOST folder that did not exist before:
   *  that one and everything under it is this job's doing. */
  async mkdir(dir: string): Promise<void> {
    const first = await mkdir(dir, { recursive: true })
    if (first) this.dirs.push(first)
  }

  /** Take it all back. Never throws: a clean-up that fails half way has
   *  still removed what it could, and there is nobody to tell. */
  async undo(): Promise<void> {
    // Retries, because Windows keeps a killed process's files busy for a
    // moment after it has closed (an antivirus scan of what was just written
    // is the usual holder).
    const gone = { recursive: true, force: true, maxRetries: 12, retryDelay: 150 }
    for (const f of this.files) await rm(f, { force: true, maxRetries: 12, retryDelay: 150 }).catch(() => {})
    for (const t of this.trees) await rm(t, gone).catch(() => {})
    // Deepest first. `rmdir` and not `rm`: a folder this job created can only
    // hold what this job wrote, all of which has just gone, so anything still
    // in it arrived from somewhere else and is not ours to delete.
    for (const d of [...this.dirs].reverse()) await pruneEmpty(d)
  }
}

/** Remove `dir` and the folders under it, as long as they are EMPTY. */
export async function pruneEmpty(dir: string): Promise<void> {
  try {
    for (const k of await readdir(dir, { withFileTypes: true }))
      if (k.isDirectory()) await pruneEmpty(join(dir, k.name))
    await rmdir(dir)
  } catch {
    // Not empty, or already gone: either way there is nothing to do.
  }
}
