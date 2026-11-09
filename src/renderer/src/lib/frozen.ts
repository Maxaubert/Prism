import { useState } from 'react'

/**
 * A value that stops following its source while `held` (the loading bar, owner
 * 2026-11-09): the listing is frozen at the moment the hold begins, and takes
 * the live value again the moment it lifts. Keyed, so a tab switch to another
 * tab on the same held folder freezes that tab's own value. Adjusted while
 * rendering, React's own pattern for state that follows props.
 */
export function useFrozen<T>(held: boolean, key: string, live: T): T {
  const [snap, setSnap] = useState<{ key: string; value: T } | null>(null)
  if (held) {
    if (!snap || snap.key !== key) {
      setSnap({ key, value: live })
      return live
    }
    return snap.value
  }
  if (snap) setSnap(null)
  return live
}
