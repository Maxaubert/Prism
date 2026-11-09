/**
 * THE LOADING BAR'S HOLD (owner, 2026-11-09: "when you delte or paste a lot of
 * images or restore with ctrl z it shoudl show a loading bar unti its done
 * because right now they jstu tickle in and teh files in teh direcotry
 * constantly move making it ahrd to navigate. so sometihn hsoudl block you from
 * interacting wiht the directory until its done"; "this is essentailly as long
 * as one or more files taek more then a second to paste,move etc."; picked: the
 * bar covers that tab's list, other tabs stay usable, Cancel).
 *
 * A file job that has run for more than BUSY_AFTER_MS holds every list showing
 * a folder it changes: the rows are frozen (the listing applies no trickle,
 * `lib/frozen`), the list is inert under the bar, and when the job ends one
 * fresh read shows the finished folder, then the hold lifts. A job that ends
 * sooner never shows anything: it was only ever a timer.
 *
 * WHY A STORE OF ITS OWN, BESIDE THE CHIP: a hold outlives its chip job for
 * the one read that shows the finished folder, and a job's chip line stays
 * after its hold has gone. Only a SHOWN hold is in the store, so the store is
 * quiet for the sub-second case, and a progress tick costs one small re-render
 * (the bar) and never a re-sort: the list follows `useHeld`, a boolean.
 */
import { useSyncExternalStore } from 'react'
import { isInside, pathKey } from '@shared/path'
import { createStore } from './store'

/** A job shows its bar only once it has run this long (owner, 2026-11-09). */
export const BUSY_AFTER_MS = 1000
/** The most the bar waits for the finished folder's read after the job ends. */
export const SETTLE_MS = 3000
/** After Cancel, the most a job that cannot stop yet keeps the list locked.
 *  It lifts; the job goes on, on the chip. A list is never locked forever. */
export const STOP_GRACE_MS = 5000
/** At most one bar update this often. */
const TICK_MS = 100

export interface HoldSpec {
  verb: string
  name?: string
  total?: number | null
  /** Folders whose rows this job changes, exactly. */
  dirs: readonly string[]
  /** Sources being moved or removed: a tab inside one is changed too. */
  under?: readonly string[]
  /** False: freeze the list but draw no bar (the extraction window IS the bar). */
  bar?: boolean
  cancel?: () => void
}

export interface Hold {
  id: string
  verb: string
  name: string | null
  dirs: ReadonlySet<string>
  under: readonly string[]
  bar: boolean
  total: number | null
  done: number
  /** 0-100, or null while the job has not said (the bar slides). */
  pct: number | null
  /** Cancel was pressed; the job has not ended yet. */
  stopping: boolean
  /** The job has ended; waiting for the read that shows the finished folder. */
  settling: boolean
  cancel: (() => void) | null
  /** The bar is on screen in the tab in front (the chip stands down for it). */
  onBar: boolean
  lastTick: number
}

const store = createStore<readonly Hold[]>([])
const pending = new Map<string, { hold: Hold; timer: ReturnType<typeof setTimeout> }>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
/** The folder the tab in front shows: a job ending with nobody on it has no
 *  read to wait for, so it lifts at once. */
let shownFolder: string | null = null

function clear(id: string): void {
  const t = timers.get(id)
  if (t) clearTimeout(t)
  timers.delete(id)
}

function drop(id: string): void {
  clear(id)
  const list = store.get()
  const next = list.filter((h) => h.id !== id)
  if (next.length !== list.length) store.set(next)
}

/** Whether this hold is on `dir`: one of its folders, or inside one of the
 *  sources it is moving or removing. */
export function holdMatches(h: Pick<Hold, 'dirs' | 'under'>, dir: string): boolean {
  const key = pathKey(dir)
  return h.dirs.has(key) || h.under.some((u) => isInside(u, key, { orEqual: true }))
}

/** A job has started. Nothing shows unless it is still running after a second. */
export function beginHold(id: string, spec: HoldSpec): void {
  const hold: Hold = {
    id,
    verb: spec.verb,
    name: spec.name ?? null,
    dirs: new Set(spec.dirs.filter(Boolean).map(pathKey)),
    under: (spec.under ?? []).filter(Boolean).map(pathKey),
    bar: spec.bar !== false,
    total: spec.total ?? null,
    done: 0,
    pct: null,
    stopping: false,
    settling: false,
    cancel: spec.cancel ?? null,
    onBar: false,
    lastTick: 0
  }
  pending.set(id, {
    hold,
    timer: setTimeout(() => {
      pending.delete(id)
      store.set([...store.get(), hold])
    }, BUSY_AFTER_MS)
  })
}

function update(id: string, change: (h: Hold) => Hold): void {
  const list = store.get()
  if (!list.some((h) => h.id === id)) return
  store.set(list.map((h) => (h.id === id ? change(h) : h)))
}

/** How far the job has got. Cheap: before the bar shows it only notes the
 *  numbers, and on screen it is at most one store update per TICK_MS. */
export function holdProgress(
  id: string,
  p: { done?: number; total?: number | null; pct?: number | null; name?: string }
): void {
  const apply = (h: Hold): Hold => ({
    ...h,
    ...(p.done !== undefined ? { done: p.done } : {}),
    ...(p.total !== undefined ? { total: p.total } : {}),
    ...(p.pct !== undefined ? { pct: p.pct } : {}),
    ...(p.name !== undefined ? { name: p.name } : {})
  })
  const wait = pending.get(id)
  if (wait) {
    Object.assign(wait.hold, apply(wait.hold))
    return
  }
  const shown = store.get().find((h) => h.id === id)
  if (!shown) return
  const now = Date.now()
  if (now - shown.lastTick < TICK_MS) {
    Object.assign(shown, apply(shown))
    return
  }
  update(id, (h) => ({ ...apply(h), lastTick: now }))
}

/** Cancel: asks the job to stop, says so on the bar, and from here the hold
 *  has STOP_GRACE_MS to end, or it lifts anyway. */
export function stopHold(id: string): void {
  const waiting = pending.get(id)
  const h = store.get().find((x) => x.id === id) ?? waiting?.hold
  if (!h || h.stopping) return
  h.cancel?.()
  // The chip's Cancel can come before the bar has shown.
  if (waiting) {
    waiting.hold.stopping = true
    waiting.hold.cancel = null
    return
  }
  update(id, (x) => ({ ...x, stopping: true, cancel: null }))
  clear(id)
  timers.set(id, setTimeout(() => drop(id), STOP_GRACE_MS))
}

/** The job is over. True when it had shown (its bar waits for the listing). */
export function endHold(id: string): boolean {
  const wait = pending.get(id)
  if (wait) {
    clearTimeout(wait.timer)
    pending.delete(id)
    return false
  }
  const h = store.get().find((x) => x.id === id)
  if (!h) return false
  clear(id)
  if (!shownFolder || !holdMatches(h, shownFolder)) {
    drop(id)
    return true
  }
  // Nothing in front is waiting on a read of it: this ends without one.
  update(id, (x) => ({
    ...x,
    settling: true,
    stopping: false,
    cancel: null,
    pct: x.pct === null ? null : 100,
    done: x.total ?? x.done
  }))
  timers.set(id, setTimeout(() => drop(id), SETTLE_MS))
  return true
}

/** The read after the job came back: the finished folder is on screen. */
export function releaseSettled(dir: string): void {
  for (const h of store.get()) if (h.settling && holdMatches(h, dir)) drop(h.id)
}

/** Which folder the tab in front shows. */
export function noteShownFolder(dir: string | null): void {
  shownFolder = dir
}

/** The bar is (not) drawn in the tab in front: the chip stands down. */
export function noteBar(id: string, on: boolean): void {
  update(id, (h) => (h.onBar === on ? h : { ...h, onBar: on }))
}

const holdsOn = (list: readonly Hold[], dir: string): Hold[] =>
  list.filter((h) => holdMatches(h, dir))

/** Is `dir` held right now? (The watcher asks; it is not a component.) */
export function isHeld(dir: string | null | undefined): boolean {
  return !!dir && holdsOn(store.get(), dir).length > 0
}

export const useHolds = store.use

/** Is `dir` held? A boolean, so a progress tick renders nothing that reads it. */
export function useHeld(dir: string | null | undefined): boolean {
  const read = (): boolean => isHeld(dir)
  return useSyncExternalStore(store.subscribe, read, read)
}

/** The settling hold on `dir`, by id: the listing reads it once and lets go. */
export function useSettling(dir: string | null | undefined): string | null {
  const read = (): string | null =>
    dir ? (holdsOn(store.get(), dir).find((h) => h.settling)?.id ?? null) : null
  return useSyncExternalStore(store.subscribe, read, read)
}

/** The hold the bar draws on `dir`, or null. The bar alone re-renders per tick. */
export function useBusyBar(dir: string): Hold | null {
  const read = (): Hold | null => holdsOn(store.get(), dir).find((h) => h.bar) ?? null
  return useSyncExternalStore(store.subscribe, read, read)
}

/** The bar's line: "Deleting 120 of 500", "Copying film.mkv", or "Stopping…". */
export function busyLabel(h: Pick<Hold, 'verb' | 'name' | 'total' | 'done' | 'stopping'>): string {
  if (h.stopping) return 'Stopping…'
  if (h.total !== null && h.total > 1) return `${h.verb} ${Math.min(h.done, h.total)} of ${h.total}`
  return h.name ? `${h.verb} ${h.name}` : h.verb
}

/** The bar's percentage, 0-100, or null while nothing is known. */
export function busyPct(h: Pick<Hold, 'pct' | 'total' | 'done'>): number | null {
  if (h.pct !== null) return Math.max(0, Math.min(100, h.pct))
  if (h.total !== null && h.total > 0) return Math.min(100, (h.done / h.total) * 100)
  return null
}

/** Test seam: forget every hold. */
export function resetHolds(): void {
  for (const w of pending.values()) clearTimeout(w.timer)
  pending.clear()
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
  shownFolder = null
  store.set([])
}
