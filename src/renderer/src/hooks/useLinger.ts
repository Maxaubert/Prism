import { useEffect, useState } from 'react'

/**
 * True while `on` is, and for `ms` after it turns false: what a closing needs
 * to stay mounted for its own animation (the preview window's fade out). A
 * turn back on within the time keeps it up without a gap.
 */
export function useLinger(on: boolean, ms: number): boolean {
  const [was, setWas] = useState(on)
  const [lingering, setLingering] = useState(false)
  // The turn itself, seen as it renders (React's "adjusting state on a prop
  // change"): turning off starts the linger, turning on ends it.
  if (on !== was) {
    setWas(on)
    setLingering(!on)
  }
  useEffect(() => {
    if (!lingering) return
    const t = window.setTimeout(() => setLingering(false), ms)
    return () => window.clearTimeout(t)
  }, [lingering, ms])
  return on || lingering
}
