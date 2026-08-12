import { useSyncExternalStore } from 'react'

// The player toggles that outlive a file: loop, autoplay (play the next video
// or track when this one ends), and whether subtitles are wanted. Persisted -
// binge tonight, binge tomorrow - and shared by both players.

export interface PlayerPrefs {
  loop: boolean
  autoplay: boolean
  /** Subtitles wanted: when on, a video that has tracks shows the first one. */
  subs: boolean
}

const KEY = 'prism.player.prefs'

function load(): PlayerPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<PlayerPrefs>
    return { loop: raw.loop === true, autoplay: raw.autoplay === true, subs: raw.subs === true }
  } catch {
    return { loop: false, autoplay: false, subs: false }
  }
}

let prefs: PlayerPrefs = load()
const listeners = new Set<() => void>()

export function setPlayerPref<K extends keyof PlayerPrefs>(key: K, value: PlayerPrefs[K]): void {
  prefs = { ...prefs, [key]: value }
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
