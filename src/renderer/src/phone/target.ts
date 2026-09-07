/**
 * Which screen the film plays on (2026-09-07, #107): the phone itself, or
 * the PC. There is ONE screen on the phone now, its own folder explorer, and
 * the choice belongs to the player rather than to the shell: you pick a film
 * and then say where it should play.
 *
 * Remembered in localStorage, because a phone left on "This PC" is the phone
 * on the arm of the sofa and the next film goes the same way. Anything the
 * key does not hold is "This phone", which is where a fresh phone starts and
 * what every kind that is not a film or a track does regardless.
 */
export const TARGET_KEY = 'prism.phone.target'

export type PhoneTarget = 'phone' | 'pc'

export function readTarget(storage: Pick<Storage, 'getItem'>): PhoneTarget {
  try {
    return storage.getItem(TARGET_KEY) === 'pc' ? 'pc' : 'phone'
  } catch {
    return 'phone'
  }
}

export function writeTarget(storage: Pick<Storage, 'setItem'>, target: PhoneTarget): void {
  try {
    storage.setItem(TARGET_KEY, target)
  } catch {
    /* private mode: the choice lasts until reload */
  }
}
