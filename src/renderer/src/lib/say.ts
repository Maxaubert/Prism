import { createStore } from './store'
import { noteOnChip } from './jobs'
import { logSaid, toastMs, SAY_TITLE, type SayOpts } from './sayCore'
import type { NoteLevel } from './noteLog'

export { SAY_TITLE, TOAST_MS, TOAST_LONG_MS, NOTE_MS, type SayKind, type SayOpts } from './sayCore'

/**
 * ONE WAY TO TELL THE USER (#517, owner 2026-11-19): `say(text, { op, level,
 * kind })`. It ALWAYS writes the diagnostics log, then shows the text where
 * its kind says:
 *  - `toast` (the default): a quick action, one shared toast at the bottom;
 *  - `chip`: the end of a long job, a line on the jobs chip;
 *  - `dialog`: an error the user must read, the one NoticeDialog.
 * A failure with `level` left out is read from its words (noteLog).
 */
export interface Toast {
  id: number
  text: string
  level: NoteLevel
}

export const toastStore = createStore<Toast | null>(null)
export const noticeStore = createStore<{ id: number; text: string; op?: string } | null>(null)
let seq = 0
let toastTimer: ReturnType<typeof setTimeout> | undefined

export function say(text: string, opts: SayOpts = {}): void {
  const kind = opts.kind ?? 'toast'
  const level = logSaid(text, {
    op: opts.op,
    level: opts.level ?? (kind === 'dialog' ? 'error' : undefined),
    title: kind === 'dialog' ? SAY_TITLE : undefined
  })
  seq += 1
  if (kind === 'chip') return noteOnChip(text, opts.op ?? 'note')
  if (kind === 'dialog') return noticeStore.set({ id: seq, text, op: opts.op })
  toastStore.set({ id: seq, text, level })
  if (toastTimer) clearTimeout(toastTimer)
  const mine = seq
  toastTimer = setTimeout(() => {
    if (toastStore.get()?.id === mine) toastStore.set(null)
  }, toastMs(level))
}

/** Test seam: forget the toast and the notice. */
export function resetSay(): void {
  if (toastTimer) clearTimeout(toastTimer)
  toastStore.set(null)
  noticeStore.set(null)
}