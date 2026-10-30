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
 * EXTRACTIONS LEFT THE CHIP (2026-09-19, #166). The owner asked for the
 * opposite of what the chip is for: "a pop-up window that you can't close,
 * kind of like it is with WinRAR, where you just see the progress bar, and
 * you just have to wait until it's done extracting." They have a window and
 * a store of their own (`lib/extraction`); pastes and adding to a zip are
 * still jobs here, and nothing about the chip changed.
 *
 * Module state with a tiny subscription, the same shape as `tabVolume` and
 * `playState`: the jobs belong to the session, not to any one component, and
 * the chip renders in two places (the sidebar footer, or floating when the
 * panel is shut) that must agree.
 */
import { useMemo, useSyncExternalStore } from 'react'
import { createStore } from './store'

export type JobKind = 'paste' | 'add'

export interface Job {
  id: string
  kind: JobKind
  /** What the chip says: "Copying", "Adding to story.zip". */
  label: string
  /** 0-100, or null while the worker has not said (indeterminate). */
  pct: number | null
  /** When it started, for the minimum showing below. */
  since: number
  /** Finished, and only lingering for the minimum showing. */
  done?: boolean
  /** Finished and past its minimum showing: off the chip, kept only so its
   *  landing rows last until the listing has the files (LAND_HOLD_MS). */
  holding?: boolean
  /** A copy's items as they land (owner, 2026-10-28): the folder, and each
   *  item with its own progress, for the rows the list draws until each
   *  file is really there. */
  landing?: { dir: string; items: LandingItem[] }
}

/** One item a paste is copying, and how far it has got (0-100). */
export interface LandingItem {
  path: string
  name: string
  isFolder: boolean
  pct: number
}

/**
 * A job SHOWS FOR AT LEAST THIS LONG (2026-09-03, owner: "the chip didn't
 * pop up, so I thought it wasn't pasting"). A small file copies inside a
 * frame, so the job started and ended before anything painted and the
 * paste looked like nothing had happened. A job that finishes early stays
 * on the chip at 100% until the minimum has passed, then leaves.
 */
export const MIN_SHOW_MS = 900

const store = createStore<readonly Job[]>([])
let seq = 0
const leaving = new Map<string, ReturnType<typeof setTimeout>>()

/** Register a job; returns its id for update/end. */
export function startJob(kind: JobKind, label: string): string {
  seq += 1
  const id = `${kind}-${seq}`
  store.set([...store.get(), { id, kind, label, pct: null, since: Date.now() }])
  return id
}

export function updateJob(id: string, pct: number | null): void {
  let changed = false
  const next = store.get().map((j) => {
    if (j.id !== id || j.pct === pct || leaving.has(j.id)) return j
    changed = true
    return { ...j, pct }
  })
  if (changed) store.set(next)
}

/** The items a copy is about to land, said once as it starts. */
export function landJob(id: string, dir: string, items: Array<Omit<LandingItem, 'pct'>>): void {
  store.set(
    store
      .get()
      .map((j) =>
        j.id === id ? { ...j, landing: { dir, items: items.map((it) => ({ ...it, pct: 0 })) } } : j
      )
  )
}

/** How far one landing item has got. The copy goes in order, so every item
 *  before it is through: main sends at most one message per tick (review,
 *  2026-10-28), and a landing it did not say is said by this. */
export function updateLanding(id: string, index: number, pct: number): void {
  let changed = false
  const next = store.get().map((j) => {
    const it = j.landing?.items[index]
    if (j.id !== id || !it) return j
    const was = j.landing!.items
    const want = (x: LandingItem, i: number): number =>
      i === index ? pct : i < index ? 100 : x.pct
    if (!was.some((x, i) => x.pct !== want(x, i))) return j
    changed = true
    const items = was.map((x, i) => (x.pct === want(x, i) ? x : { ...x, pct: want(x, i) }))
    return { ...j, landing: { dir: j.landing!.dir, items } }
  })
  if (changed) store.set(next)
}

export type LandingRow = LandingItem & { since: number }

/** Every item a paste is landing in `dir` (case-insensitive), by its path. A
 *  landed one (100) stays too: the list drops it once the listing has the
 *  real file, so a row never blinks out before its file shows (review,
 *  2026-10-28). */
export function landingIn(list: readonly Job[], dir: string): LandingRow[] {
  const norm = (p: string): string => p.toLowerCase().replace(/[\\/]+$/, '')
  const key = norm(dir)
  return list.flatMap((j) =>
    j.landing && norm(j.landing.dir) === key
      ? j.landing.items.map((it) => ({ ...it, since: j.since }))
      : []
  )
}

const NO_ROWS: readonly LandingRow[] = []

function sameRows(a: readonly LandingRow[], b: readonly LandingRow[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (x, i) =>
        x.path === b[i].path &&
        x.pct === b[i].pct &&
        x.isFolder === b[i].isFolder &&
        x.since === b[i].since
    )
  )
}

/** A reader of `landingIn(dir)` that hands back the SAME array while nothing
 *  landing in `dir` changed, for the hook below (pure, so testable). */
export function landingReader(
  dir: string,
  get: () => readonly Job[] = store.get
): () => readonly LandingRow[] {
  let from: readonly Job[] | null = null
  let last: readonly LandingRow[] = NO_ROWS
  return () => {
    const list = get()
    if (list === from) return last
    from = list
    const next = landingIn(list, dir)
    if (!sameRows(last, next)) last = next.length ? next : NO_ROWS
    return last
  }
}

/** What is landing in `dir`, following the store: a component renders again
 *  only when THIS folder's rows change, not on every job's tick (review,
 *  2026-10-28: every open Explorer tab re-rendered on every paste tick). */
export function useLandingIn(dir: string): readonly LandingRow[] {
  const read = useMemo(() => landingReader(dir), [dir])
  return useSyncExternalStore(store.subscribe, read, read)
}

/** How long a finished paste keeps its rows for the listing to catch up
 *  (2026-10-29: the job ended, its rows went, and the folder's re-list had
 *  not brought the new file yet, so the file blinked out: 5, 6, 5, 6). The
 *  list drops each row as soon as the real file is there. */
export const LAND_HOLD_MS = 4000
const holdTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** Past its minimum showing: off the chip, kept only for its rows. */
function hold(id: string): void {
  holdTimers.delete(id)
  store.set(store.get().map((j) => (j.id === id && !j.holding ? { ...j, holding: true } : j)))
}

function remove(id: string): void {
  leaving.delete(id)
  const t = holdTimers.get(id)
  if (t) clearTimeout(t)
  holdTimers.delete(id)
  const jobs = store.get()
  const next = jobs.filter((j) => j.id !== id)
  if (next.length === jobs.length) return
  store.set(next)
}

export function endJob(id: string): void {
  const jobs = store.get()
  const job = jobs.find((j) => j.id === id)
  if (!job || leaving.has(id)) return
  const shown = Date.now() - job.since
  if (job.landing) {
    const minLeft = Math.max(0, MIN_SHOW_MS - shown)
    store.set(
      jobs.map((j) =>
        j.id === id
          ? { ...j, pct: 100, done: true, ...(minLeft === 0 ? { holding: true } : {}) }
          : j
      )
    )
    if (minLeft > 0)
      holdTimers.set(
        id,
        setTimeout(() => hold(id), minLeft)
      )
    leaving.set(
      id,
      setTimeout(() => remove(id), Math.max(minLeft, LAND_HOLD_MS))
    )
    return
  }
  if (shown >= MIN_SHOW_MS) return remove(id)
  // Too quick to have been seen: hold it at done for the rest of the minimum.
  store.set(jobs.map((j) => (j.id === id ? { ...j, pct: 100, done: true } : j)))
  leaving.set(
    id,
    setTimeout(() => remove(id), MIN_SHOW_MS - shown)
  )
}

export const listJobs = store.get

/** Test seam: forget every job. */
export function resetJobs(): void {
  for (const t of leaving.values()) clearTimeout(t)
  leaving.clear()
  for (const t of holdTimers.values()) clearTimeout(t)
  holdTimers.clear()
  store.set([])
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
  const shown = list.filter((j) => !j.holding)
  if (!shown.length) return null
  const head = shown.find((j) => !j.done) ?? shown[0]
  return { label: head.label, pct: head.pct, more: shown.length - 1 }
}

export const useJobs = store.use
