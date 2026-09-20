/**
 * THE EXTRACTION WINDOW'S STATE (2026-09-19, #166).
 *
 * Owner: "I would like it to just be one kind of view that appears, and I
 * want it to be a pop-up window that you can't close, kind of like it is with
 * WinRAR, where you just see the progress bar, and you just have to wait
 * until it's done extracting." Asked the same day, it gets a Cancel button.
 *
 * This SUPERSEDES the chip for extractions (2026-09-03, which itself replaced
 * a popup): the chip was chosen so that you could keep working past a long
 * job, and the owner has now chosen the opposite for this one verb. Pastes
 * and adding to a zip stay on the chip; `lib/jobs` is untouched.
 *
 * ONE reducer for every route. The routes differ in main (which engine, where
 * the staging folder is, what the landing rule is) and not at all in here:
 * main opens a job, says how far along it is, and says how it ended
 * (`shared/extraction.ts`). Pure, so every rule about when the window is up
 * is a unit test rather than something to be eyeballed through five menus.
 *
 * The rules, in one place:
 * - It MOUNTS on `start` and UNMOUNTS on the end of the work. Nothing else
 *   takes it down: `dismiss` is ignored while a job runs, so Escape and a
 *   click outside have nothing to call even if somebody wires them by
 *   mistake.
 * - Success closes it SILENTLY. The owner's 2026-08-31 rule that finishing
 *   raises no popup still holds: there is no second dialog, the window that
 *   was already up simply goes.
 * - Failure turns the SAME window into the error, which only Close removes.
 * - Cancel is a REQUEST. The window stays, saying so, until main reports
 *   that the process is gone and the half-written files are removed: a
 *   window that vanished at the click would be claiming a clean-up that had
 *   not happened yet.
 */
import { useSyncExternalStore } from 'react'
import type { ExtractEvent, ExtractFail } from '@shared/extraction'

/**
 * A window that was up for less than this stays, full, for the remainder.
 *
 * A small zip extracts inside a frame, so the window would mount and unmount
 * before it ever painted, or flash for 30ms and read as a glitch. The paste
 * chip met the first half of this on 2026-09-03 (owner: "the chip didn't pop
 * up, so I thought it wasn't pasting") and answered it the same way. Shorter
 * than the chip's 900ms because this one blocks the app while it lingers.
 */
export const MIN_SHOW_MS = 700

interface Showing {
  id: string
  archive: string
  dest: string
  /** 0-100, or null until the engine has said anything. */
  pct: number | null
  /** The member being written right now; '' before the first. */
  file: string
  /** When it mounted, for the minimum showing. */
  since: number
  asksPassword: boolean
}

export type ExtractState =
  | { phase: 'idle' }
  | ({ phase: 'running' | 'cancelling' | 'leaving' } & Showing)
  | {
      phase: 'failed'
      id: string
      archive: string
      dest: string
      reason?: ExtractFail
      message?: string
    }

export type ExtractAction =
  | ExtractEvent
  /** The Cancel button. */
  | { type: 'cancel-asked' }
  /** The error's Close button. */
  | { type: 'dismiss' }
  /** The minimum-showing timer. */
  | { type: 'tick' }

export const IDLE: ExtractState = { phase: 'idle' }

/** When a `leaving` window may go; null in every other phase. */
export function leavesAt(s: ExtractState): number | null {
  return s.phase === 'leaving' ? s.since + MIN_SHOW_MS : null
}

export function reduce(s: ExtractState, a: ExtractAction, now: number): ExtractState {
  switch (a.type) {
    case 'start':
      // Main runs one visible extraction at a time, so a start always owns
      // the window: over idle, and over an error somebody left on screen.
      return {
        phase: 'running',
        id: a.id,
        archive: a.archive,
        dest: a.dest,
        pct: null,
        file: '',
        since: now,
        asksPassword: !!a.asksPassword
      }
    case 'progress': {
      if (s.phase !== 'running' && s.phase !== 'cancelling') return s
      if (s.id !== a.id) return s
      // Two measures feed one bar (7-Zip's percentage, and a count of files
      // as the fallback), so it only ever grows.
      const pct = a.pct === null ? s.pct : Math.max(s.pct ?? 0, Math.min(100, a.pct))
      return { ...s, pct, file: a.file || s.file }
    }
    case 'end': {
      if (s.phase === 'idle' || s.phase === 'failed' || s.phase === 'leaving') return s
      if (s.id !== a.id) return s
      if (a.result === 'cancelled') return IDLE
      if (a.result === 'failed') {
        if (a.reason === 'password' && s.asksPassword) return IDLE
        return {
          phase: 'failed',
          id: s.id,
          archive: s.archive,
          dest: s.dest,
          reason: a.reason,
          message: a.message
        }
      }
      // Done. Somebody who pressed Cancel has been looking at it for long
      // enough whatever the clock says.
      if (s.phase === 'cancelling' || now - s.since >= MIN_SHOW_MS) return IDLE
      return { ...s, phase: 'leaving', pct: 100 }
    }
    case 'cancel-asked':
      return s.phase === 'running' ? { ...s, phase: 'cancelling' } : s
    case 'dismiss':
      return s.phase === 'failed' ? IDLE : s
    case 'tick':
      return s.phase === 'leaving' && now >= s.since + MIN_SHOW_MS ? IDLE : s
  }
}

/** The error's one paragraph. The password sentence is the one the verbs
 *  have always used: the archive panel is where a password is typed, so the
 *  way forward is to open a member there first. */
export function failureText(reason: ExtractFail | undefined, message?: string): string {
  if (reason === 'password')
    return 'This archive is password protected. Open one of its files first to unlock it, then extract again.'
  if (reason === 'aes')
    return 'This archive is AES-encrypted, and the 7-Zip that opens those is missing from this install.'
  // 7-Zip's own line when there is one: "couldn't be extracted" on its own
  // is a failure nobody can act on.
  return message ? `That couldn't be extracted. ${message}` : "That couldn't be extracted."
}

/**
 * Shorten in the MIDDLE, keeping both ends.
 *
 * A member is named by its path, and the part that tells two of them apart
 * is the END (the file's own name), which is exactly what CSS's
 * `text-overflow: ellipsis` throws away. The tail gets the odd character for
 * the same reason. Counted in characters, which in a proportional face is an
 * estimate: the element still carries `truncate` as the backstop.
 */
export function middleEllipsis(text: string, max: number): string {
  if (text.length <= max) return text
  if (max <= 1) return '…'
  const keep = max - 1
  const head = Math.floor(keep / 2)
  const tail = keep - head
  return text.slice(0, head) + '…' + text.slice(text.length - tail)
}

/* ----- the store: module state with a tiny subscription, as `jobs` is ----- */

let state: ExtractState = IDLE
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | null = null

export function dispatch(a: ExtractAction, now = Date.now()): void {
  const next = reduce(state, a, now)
  if (next === state) return
  state = next
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  const at = leavesAt(state)
  // The tick is stamped no earlier than the moment it was set for: a timer
  // may fire a millisecond short of its delay, and a tick judged too early
  // would leave a finished window up with nothing left to take it down.
  if (at !== null)
    timer = setTimeout(
      () => dispatch({ type: 'tick' }, Math.max(Date.now(), at)),
      Math.max(0, at - now)
    )
  for (const l of listeners) l()
}

export const extractState = (): ExtractState => state

/** Is the window up? Read by the key guard, which is not a component. */
export const extractionUp = (): boolean => state.phase !== 'idle'

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useExtraction(): ExtractState {
  return useSyncExternalStore(subscribe, extractState, extractState)
}

/** Test seam. */
export function resetExtraction(): void {
  if (timer) clearTimeout(timer)
  timer = null
  state = IDLE
  for (const l of listeners) l()
}
