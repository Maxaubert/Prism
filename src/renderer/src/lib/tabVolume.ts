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
  levels.delete(key)
}
