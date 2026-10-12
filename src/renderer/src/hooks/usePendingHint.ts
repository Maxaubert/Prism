import { useEffect, useState } from 'react'

/**
 * HOW A FOLDER THAT HAS NOT ANSWERED YET LOOKS (#271; owner, 2026-10-04: "I
 * don't ever want to see that", of "Loading folder..."). There is no loading
 * screen and no loading text. 'quiet' is the first 300 ms: the list keeps the
 * rows it had (dimmed after 120 ms, by CSS), because MEASURED, no ordinary
 * folder takes that long for its names (WinSxS, the biggest on this machine,
 * 26 ms). 'slow' is past that: the list shows its header and a thin bar
 * under it, and the status line says what is happening. 'none' is a list
 * with nothing outstanding.
 */
export type ListPending = 'none' | 'quiet' | 'slow'

export const SLOW_HINT_MS = 300

/** `waitingKey` names what is being waited for (null: nothing), so a new
 *  navigation starts its own 300 ms. */
export function usePendingHint(waitingKey: string | null, delay = SLOW_HINT_MS): ListPending {
  const [slowFor, setSlowFor] = useState<string | null>(null)
  useEffect(() => {
    if (waitingKey === null) return
    const timer = setTimeout(() => setSlowFor(waitingKey), delay)
    return () => clearTimeout(timer)
  }, [waitingKey, delay])
  if (waitingKey === null) return 'none'
  return slowFor === waitingKey ? 'slow' : 'quiet'
}
