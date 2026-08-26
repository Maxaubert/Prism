import { useSyncExternalStore } from 'react'

// The player toggles that outlive a file: loop, autoplay (play the next video
// or track when this one ends), and whether subtitles are wanted. Persisted -
// binge tonight, binge tomorrow - and shared by both players.

export interface PlayerPrefs {
  loop: boolean
  autoplay: boolean
  /** Subtitles wanted: when on, a video that has tracks shows the first one. */
  subs: boolean
  /**
   * Pause when Prism is not what you are looking at (2026-08-26).
   *
   * The wording follows the players that already have this: VLC's "Pause
   * playback when minimized" and PotPlayer's "Pause playback when focus lost"
   * are the two conventions, so both are offered rather than invented:
   *
   *  'off'       - never; what Prism has always done.
   *  'minimised' - when the window is minimised (VLC's).
   *  'unfocused' - whenever another window has the focus (PotPlayer's).
   */
  background: BackgroundPause
}

export type BackgroundPause = 'off' | 'minimised' | 'unfocused'

const KEY = 'prism.player.prefs'

function load(): PlayerPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<PlayerPrefs>
    const loop = raw.loop === true
    // Loop and autoplay are mutually exclusive (a looping file never ends, so
    // autoplay could never fire); if a stored state has both, loop wins.
    const bg: BackgroundPause =
      raw.background === 'minimised' || raw.background === 'unfocused' ? raw.background : 'off'
    return { loop, autoplay: !loop && raw.autoplay === true, subs: raw.subs === true, background: bg }
  } catch {
    return { loop: false, autoplay: false, subs: false, background: 'off' }
  }
}

let prefs: PlayerPrefs = load()
const listeners = new Set<() => void>()

export function setPlayerPref<K extends keyof PlayerPrefs>(key: K, value: PlayerPrefs[K]): void {
  prefs = { ...prefs, [key]: value }
  // The exclusivity above, kept live: switching one on switches the other off.
  if (key === 'loop' && value === true) prefs = { ...prefs, autoplay: false }
  if (key === 'autoplay' && value === true) prefs = { ...prefs, loop: false }
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    /* no storage: it lasts the session */
  }
  listeners.forEach((l) => l())
}

export function usePlayerPrefs(): PlayerPrefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => prefs
  )
}
