import { beginHold, endHold, holdProgress, stopHold, type HoldSpec } from './holds'
import { endJob, startJob, type JobKind } from './jobs'

/**
 * ONE WAY TO RUN A JOB THAT CHANGES A FOLDER (owner, 2026-11-09, the loading
 * bar). Everything that adds, moves or removes files goes through here, so
 * every one of them has the threshold, the hold, Cancel, and the `finally`
 * that always ends the bar, whatever the job did: a throw, a main process
 * error, a window closed underneath it.
 */
export interface FileJobSpec extends Omit<HoldSpec, 'cancel'> {
  kind: JobKind
  /** On the chip from the first moment (a paste, as it always was). Otherwise
   *  the chip hears of it only once the bar has shown. */
  early?: boolean
  /** The job cannot be stopped partway (one rewrite of a zip): no Cancel. */
  stoppable?: boolean
  /** Main's cancel for this job, when it is not the generic one. */
  cancelInMain?: (id: string) => Promise<unknown>
}

export interface FileJob {
  id: string
  signal: AbortSignal
  stopped: () => boolean
  /** How many items are through (and, when it changed, of how many). */
  count: (done: number, total?: number) => void
  /** The quiet line said when it is over (how much was done, on Cancel). */
  note: (text: string) => void
}

/** Run `work` as a job. Its Cancel aborts `signal` and tells main. */
export async function withFileJob<T>(
  spec: FileJobSpec,
  work: (job: FileJob) => Promise<T>
): Promise<T> {
  const stop = new AbortController()
  let id = ''
  let note: string | undefined
  const cancel =
    spec.stoppable === false
      ? undefined
      : (): void => {
          stop.abort()
          void (spec.cancelInMain ?? window.prism.cancelFileJob)(id).catch(() => {})
        }
  id = startJob(spec.kind, spec.verb, cancel && (() => stopHold(id)), { late: spec.early !== true })
  beginHold(id, { ...spec, cancel })
  const job: FileJob = {
    id,
    signal: stop.signal,
    stopped: () => stop.signal.aborted,
    count: (done, total) =>
      holdProgress(id, { done, ...(total !== undefined ? { total } : {}) }),
    note: (text) => {
      note = text
    }
  }
  try {
    return await work(job)
  } finally {
    const shown = endHold(id)
    endJob(id, note, { forget: !shown })
  }
}

/** The quiet line after Cancel: "Stopped. Deleted 120 of 500." */
export const stoppedNote = (did: string, done: number, total: number): string =>
  `Stopped. ${did} ${done} of ${total}.`
