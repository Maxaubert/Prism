/**
 * Volume belongs to the TAB, for as long as the app is open (2026-08-27).
 *
 * It used to be one number in localStorage: every file in every tab shared it,
 * and it came back tomorrow. Neither is what a volume knob means. A tab is one
 * thing you are watching, so it keeps its own level while you flick between
 * files in it - a folder of episodes with photos in between does not reset
 * anything - and a NEW tab starts at 100%, like a machine you just turned on.
 *
 * Nothing here is persisted: tomorrow is a new session, and a film that opens
 * at some volume you set on a different film last week is a surprise.
 */
export const DEFAULT_VOLUME = 1

interface Level {
  vol: number
  muted: boolean
}

const levels = new Map<string, Level>()

export function tabVolume(key: string): Level {
  return levels.get(key) ?? { vol: DEFAULT_VOLUME, muted: false }
}

export function setTabVolume(key: string, level: Level): void {
  if (!key) return
  levels.set(key, level)
}

/** A closed tab takes its level with it: the id never comes back. */
export function forgetTabVolume(key: string): void {
  rates.delete(key)
  levels.delete(key)
}

/**
 * SPEED rides with the level (#207; owner, 2026-09-23: "if the user mutes
 * audio or sets speed to be 0.5 and then clicks a new video, those settings
 * should be kept ... or dissect videos in half speed"). The player kept its
 * speed only while it stayed mounted, and it is keyed by KIND: a photo or a
 * track between two films, or a new tab entry, brought it back at 1x. Same
 * scope as the level: this tab, this session, never on disk.
 */
export const DEFAULT_RATE = 1

const rates = new Map<string, number>()

export function tabRate(key: string): number {
  return rates.get(key) ?? DEFAULT_RATE
}

export function setTabRate(key: string, rate: number): void {
  if (!key || !(rate > 0)) return
  rates.set(key, rate)
}
