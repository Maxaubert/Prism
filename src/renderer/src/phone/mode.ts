/**
 * Watch or Remote (2026-09-07, #107): which of its two jobs the phone page
 * is doing. Remembered in localStorage so a phone that was a remote comes
 * back as one, since that is the phone that sits on the arm of the sofa
 * while the PC plays. Anything the key does not hold is Watch, which is
 * where a fresh phone starts.
 */
export const MODE_KEY = 'prism.phone.mode'

export type PhoneMode = 'watch' | 'remote'

export function readMode(storage: Pick<Storage, 'getItem'>): PhoneMode {
  try {
    return storage.getItem(MODE_KEY) === 'remote' ? 'remote' : 'watch'
  } catch {
    return 'watch'
  }
}

export function writeMode(storage: Pick<Storage, 'setItem'>, mode: PhoneMode): void {
  try {
    storage.setItem(MODE_KEY, mode)
  } catch {
    /* private mode: the choice lasts until reload */
  }
}
