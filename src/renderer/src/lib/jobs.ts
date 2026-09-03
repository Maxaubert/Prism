/**
 * THE JOB QUEUE (2026-09-03, owner). Long work - a paste, an extraction,
 * files added to a zip - used to raise a modal popup, which blocked the app
 * for as long as it ran. It is a CHIP now, an overlay you can work past, and
 * this is the store behind it: every running job in the order it started,
 * with the byte or member progress its worker reports. Several jobs run at
 * once (extract one archive, walk to the next, extract that too) and the chip
 * shows the oldest with a count of the rest. A job that fails still speaks
 * through its own dialog; a job that finishes simply leaves.
 *
 * Module state with a tiny subscription, the same shape as `tabVolume` and
 * `playState`: the jobs belong to the session, not to any one component, and
 * the chip renders in two places (the sidebar footer, or floating when the
 * panel is shut) that must agree.
 */
import { useSyncExternalStore } from 'react'

export type JobKind = 'paste' | 'extract' | 'add'

export interface Job {
  id: string
  kind: JobKind
  /** What the chip says: "Copying", "Extracting story.cbz". */
  label: string
  /** 0-100, or null while the worker has not said (indeterminate). */
  pct: number | null
  /** When it started, for the minimum showing below. */
  since: number
  /** Finished, and only lingering for the minimum showing. */
  done?: boolean
}

/**
 * A job SHOWS FOR AT LEAST THIS LONG (2026-09-03, owner: "the chip didn't
 * pop up, so I thought it wasn't pasting"). A small file copies inside a
 * frame, so the job started and ended before anything painted and the
 * paste looked like nothing had happened. A job that finishes early stays
 * on the chip at 100% until the minimum has passed, then leaves.
 */
export const MIN_SHOW_MS = 900

let jobs: readonly Job[] = []
const listeners = new Set<() => void>()
let seq = 0
const leaving = new Map<string, ReturnType<typeof setTimeout>>()

function emit(): void {
  for (const l of listeners) l()
}

/** Register a job; returns its id for update/end. */
export function startJob(kind: JobKind, label: string): string {
  seq += 1
  const id = `${kind}-${seq}`
  jobs = [...jobs, { id, kind, label, pct: null, since: Date.now() }]
  emit()
  return id
}

export function updateJob(id: string, pct: number | null): void {
  let changed = false
  jobs = jobs.map((j) => {
    if (j.id !== id || j.pct === pct || leaving.has(j.id)) return j
    changed = true
    return { ...j, pct }
  })
  if (changed) emit()
}

function remove(id: string): void {
  leaving.delete(id)
  const next = jobs.filter((j) => j.id !== id)
  if (next.length === jobs.length) return
  jobs = next
  emit()
}

export function endJob(id: string): void {
  const job = jobs.find((j) => j.id === id)
  if (!job || leaving.has(id)) return
  const shown = Date.now() - job.since
  if (shown >= MIN_SHOW_MS) return remove(id)
  // Too quick to have been seen: hold it at done for the rest of the minimum.
  jobs = jobs.map((j) => (j.id === id ? { ...j, pct: 100, done: true } : j))
  emit()
  leaving.set(
    id,
    setTimeout(() => remove(id), MIN_SHOW_MS - shown)
  )
}

export const listJobs = (): readonly Job[] => jobs

/** Test seam: forget every job. */
export function resetJobs(): void {
  for (const t of leaving.values()) clearTimeout(t)
  leaving.clear()
  jobs = []
  emit()
}

/**
 * What the chip draws: the oldest job STILL WORKING (the one you have been
 * waiting on longest, and the one most likely to finish next), and how many
 * more are behind it. A job that has finished and is only lingering for its
 * minimum showing yields to any live one - otherwise a second paste opened
 * on the first paste's 100% and then fell to 0 (owner, 2026-09-03). It is
 * shown only when nothing else is running. Pure, so the chip's arithmetic
 * is testable without React.
 */
export function chipSummary(
  list: readonly Job[]
): { label: string; pct: number | null; more: number } | null {
  if (!list.length) return null
  const head = list.find((j) => !j.done) ?? list[0]
  return { label: head.label, pct: head.pct, more: list.length - 1 }
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useJobs(): readonly Job[] {
  return useSyncExternalStore(subscribe, listJobs, listJobs)
}
