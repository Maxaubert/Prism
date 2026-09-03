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
}

let jobs: readonly Job[] = []
const listeners = new Set<() => void>()
let seq = 0

function emit(): void {
  for (const l of listeners) l()
}

/** Register a job; returns its id for update/end. */
export function startJob(kind: JobKind, label: string): string {
  seq += 1
  const id = `${kind}-${seq}`
  jobs = [...jobs, { id, kind, label, pct: null }]
  emit()
  return id
}

export function updateJob(id: string, pct: number | null): void {
  let changed = false
  jobs = jobs.map((j) => {
    if (j.id !== id || j.pct === pct) return j
    changed = true
    return { ...j, pct }
  })
  if (changed) emit()
}

export function endJob(id: string): void {
  const next = jobs.filter((j) => j.id !== id)
  if (next.length === jobs.length) return
  jobs = next
  emit()
}

export const listJobs = (): readonly Job[] => jobs

/** Test seam: forget every job. */
export function resetJobs(): void {
  jobs = []
  emit()
}

/**
 * What the chip draws: the OLDEST job (it is the one you have been waiting
 * on longest, and the one most likely to finish next) and how many more are
 * queued behind it. Pure, so the chip's arithmetic is testable without React.
 */
export function chipSummary(
  list: readonly Job[]
): { label: string; pct: number | null; more: number } | null {
  if (!list.length) return null
  const head = list[0]
  return { label: head.label, pct: head.pct, more: list.length - 1 }
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useJobs(): readonly Job[] {
  return useSyncExternalStore(subscribe, listJobs, listJobs)
}
