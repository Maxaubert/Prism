/**
 * A localStorage read that never throws. Storage can refuse (a profile it
 * cannot open, a quota error, a browser that blocks it), and a read in a
 * component's initialiser that throws takes the whole window down with it.
 * Refused reads as never set, so every caller falls back to its default.
 */
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
