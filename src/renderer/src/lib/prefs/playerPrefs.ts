import { createPref } from './createPref'

// The player toggles that outlive a file: loop, autoplay (play the next video
// or track when this one ends), and whether subtitles are wanted. Persisted -
// binge tonight, binge tomorrow - and shared by both players.

export interface PlayerPrefs {
  loop: boolean
  autoplay: boolean
  /** Subtitles wanted: when on, a video that has tracks shows the first one. */
  subs: boolean
  /**
   * Pause when Prism is not what you are looking at (2026-08-26): another
   * window has the focus, or Prism is minimised - PotPlayer's "Pause playback
   * when focus lost", which covers VLC's minimised case as well, since a
   * minimised window has no focus either. Off by default.
   */
  background: boolean
}

const OFF: PlayerPrefs = { loop: false, autoplay: false, subs: false, background: false }

const pref = createPref<PlayerPrefs>({
  key: 'prism.player.prefs',
  parse: (stored) => {
    const raw = JSON.parse(stored ?? '{}') as Partial<PlayerPrefs>
    const loop = raw.loop === true
    // Loop and autoplay are mutually exclusive (a looping file never ends, so
    // autoplay could never fire); if a stored state has both, loop wins.
    // A stored 'minimised' or 'unfocused' from the three-way version reads as
    // on; anything else, including the old 'off', reads as off.
    const bg: unknown = raw.background
    const background = bg === true || bg === 'minimised' || bg === 'unfocused'
    return { loop, autoplay: !loop && raw.autoplay === true, subs: raw.subs === true, background }
  },
  serialize: (prefs) => JSON.stringify(prefs),
  fallback: OFF
})

export function setPlayerPref<K extends keyof PlayerPrefs>(key: K, value: PlayerPrefs[K]): void {
  let prefs: PlayerPrefs = { ...pref.get(), [key]: value }
  // The exclusivity above, kept live: switching one on switches the other off.
  if (key === 'loop' && value === true) prefs = { ...prefs, autoplay: false }
  if (key === 'autoplay' && value === true) prefs = { ...prefs, loop: false }
  pref.set(prefs)
}

export const usePlayerPrefs = pref.use
