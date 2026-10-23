import type { UpdateInfo, UpdatePhase } from '../../shared/updateTypes'

// What the update chip and its window are doing, as one pure reducer (#28).
//
// The chip used to install on a click. Owner, 2026-09-19: "when you click the
// Update badge, it opens like a pop window, which shows the change log or like
// patch notes for the new update, and then you can choose cancel or install."
// So there are now two things on screen that must agree (a chip and a window),
// and several ways for an install to end (the app quits under the installer,
// the download fails, it was cancelled, or it was a preview). Written as a
// reducer so every one of those is a test and not a sequence of setState calls
// in two apps.
//
// THE WINDOW STAYS FOR THE INSTALL (#32). Owner, 2026-09-20: "when you click
// install keep me with the panel open and have the progress bar straight there,
// kind of like the way extract works for zip files in Prism." This SUPERSEDES
// #28's "the window closes on Install and the chip is the progress bar": Install
// keeps `open`, the window draws the bar, and while the install runs the USER
// cannot put the window away (Cancel there cancels the download, where the host
// can). How it ended is said in the same window. The line under the chip is now
// only for an ending nobody was looking at: the window was hidden by the host.
//
// The hook that drives it is `useUpdateFlow`; this file knows nothing about
// React, the bridge or a host.

/** Said when a preview's fake install finishes. */
export const PREVIEW_DONE = 'Preview only: nothing was installed'
/** Said when a real download failed. It used to fail silently: the chip went
 *  from 37% back to "Update" and said nothing about why. */
export const INSTALL_FAILED = 'The update could not be downloaded. Nothing was installed.'

export interface UpdateFlow {
  /** The offer. Null means no chip at all. */
  info: UpdateInfo | null
  phase: UpdatePhase
  /** 0 to 100, whole, and only ever rising within one install. */
  pct: number
  /** The window with the notes (and, during an install, the bar) is up. */
  open: boolean
  /** How the last install ended. Shown IN the window while it is up, and as a
   *  line under the chip when it is not. */
  notice: string | null
  /** Cancel was pressed during the download and the bridge has not answered. */
  aborting: boolean
}

export const NO_UPDATE: UpdateFlow = {
  info: null,
  phase: 'idle',
  pct: 0,
  open: false,
  notice: null,
  aborting: false
}

export type UpdateAction =
  | { type: 'available'; info: UpdateInfo }
  /** The chip was clicked, or the host uncovered a running install. */
  | { type: 'open' }
  /** The USER backing out: Cancel or Close, Escape, a press outside. Refused
   *  while an install runs. */
  | { type: 'cancel' }
  /** The HOST putting the window away because something that outranks it is on
   *  screen (a close question). Allowed in any phase; the install carries on. */
  | { type: 'hide' }
  /** Install was chosen AND the host let it start (its close question, if it
   *  has one to ask, comes before this). */
  | { type: 'install' }
  | { type: 'progress'; pct: number }
  /** Cancel was pressed during the download. */
  | { type: 'abort' }
  /** The bridge answered. `ok` means the app is about to quit under the
   *  installer; false means nothing was installed. */
  | { type: 'settled'; ok: boolean }
  | { type: 'dismiss' }

/** `Number(undefined)` is NaN and a bar at NaN% is a bar at 0: read it as one. */
const wholePct = (n: number): number =>
  Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0

export function updateFlow(s: UpdateFlow, a: UpdateAction): UpdateFlow {
  switch (a.type) {
    case 'available':
      // An offer that arrives mid-install is not swapped in under the bar: what
      // is downloading is the one the user read the notes for.
      return s.phase === 'idle' ? { ...s, info: a.info } : s
    case 'open':
      if (!s.info || s.open) return s
      // Opened fresh, the last ending is history. Opened over a running
      // install, nothing is touched but the window.
      return s.phase === 'idle' ? { ...s, open: true, notice: null } : { ...s, open: true }
    case 'cancel':
      // NOT DISMISSABLE WHILE IT RUNS: a window that could be closed over a
      // download would leave an install going with nothing on screen saying so.
      if (!s.open || s.phase !== 'idle') return s
      // Closing the window that showed how it ended is having read it.
      return { ...s, open: false, notice: null }
    case 'hide':
      return s.open ? { ...s, open: false } : s
    case 'install':
      return s.info && s.phase === 'idle'
        ? { ...s, open: true, phase: 'downloading', pct: 0, notice: null, aborting: false }
        : s
    case 'progress': {
      if (s.phase === 'idle') return s
      const pct = Math.max(s.pct, wholePct(a.pct))
      return { ...s, pct, phase: pct >= 100 ? 'installing' : s.phase }
    }
    case 'abort':
      // Only the DOWNLOAD can be cancelled. At 100 the installer has been
      // handed the file and the app is on its way out.
      return s.phase === 'downloading' && !s.aborting ? { ...s, aborting: true } : s
    case 'settled':
      if (s.phase === 'idle' || a.ok) return s
      // A cancel is not a failure and is not reported as one: the window goes,
      // as it does for Cancel before an install, and the chip offers it again.
      if (s.aborting) return { ...s, phase: 'idle', pct: 0, open: false, notice: null, aborting: false }
      // `open` is left as it is: said in the window if it is up, under the chip
      // if the host had hidden it.
      return {
        ...s,
        phase: 'idle',
        pct: 0,
        aborting: false,
        notice: s.info?.mock ? PREVIEW_DONE : INSTALL_FAILED
      }
    case 'dismiss':
      return s.notice === null ? s : { ...s, notice: null }
  }
}
