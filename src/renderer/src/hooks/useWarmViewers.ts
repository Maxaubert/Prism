import { useEffect, useMemo, useRef, useState } from 'react'
import { warmOf } from '../lib/viewerCache'

/** How long the viewers stay warm after the window loses focus. */
const WARM_COOLDOWN_MS = 60_000

/** The warm viewers (moved out of App.tsx, #538 item 9): every warm tab is
 * mounted, the strip only decides which one is on screen. Held while the
 * window has the focus and for a minute after it loses it. The timer only
 * ever RELEASES, so a missed signal can only keep memory the next switch
 * bounds anyway. */
export function useWarmViewers(
  tabs: Parameters<typeof warmOf>[0],
  activeId: Parameters<typeof warmOf>[2]
): ReturnType<typeof warmOf>['entries'] {
  const [keepWarm, setKeepWarm] = useState(true)
  useEffect(() => {
    let cool: ReturnType<typeof setTimeout> | null = null
    const off = window.prism.onWindowState((st) => {
      if (cool) {
        clearTimeout(cool)
        cool = null
      }
      if (st.focused && !st.minimised) setKeepWarm(true)
      else cool = setTimeout(() => setKeepWarm(false), WARM_COOLDOWN_MS)
    })
    return () => {
      if (cool) clearTimeout(cool)
      off()
    }
  }, [])
  const warmOrder = useRef<string[]>([])
  // The order is a ref on purpose: derived from the tabs in the same pass that
  // renders them, and it only ever appends, so a re-render has nothing to settle.
  /* eslint-disable react-hooks/refs */
  return useMemo(() => {
    const next = warmOf(tabs, warmOrder.current, activeId, keepWarm)
    warmOrder.current = next.order
    return next.entries
  }, [tabs, activeId, keepWarm])
  /* eslint-enable react-hooks/refs */
}