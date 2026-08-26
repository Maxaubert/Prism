import { useEffect, type RefObject } from 'react'
import { usePlayerPrefs } from './playerPrefs'
import { decide } from './backgroundPause'

/**
 * Pause when Prism is not what you are looking at: another window has the
 * focus, or Prism is minimised. Off by default, which is what Prism has always
 * done. The rule itself lives in ./backgroundPause, where it can be tested.
 *
 * The signal comes from MAIN, not from the page: Electron does not mark a
 * minimised window hidden, so `visibilitychange` never fires and
 * `document.hidden` stays false however small the window gets.
 */
export function useBackgroundPause(ref: RefObject<HTMLMediaElement | null>): void {
  const { background } = usePlayerPrefs()
  useEffect(() => {
    if (!background) return
    let ours = false
    return window.prism.onWindowState((state) => {
      const el = ref.current
      if (!el) return
      const next = decide(state, el, ours)
      ours = next.ours
      if (next.action === 'pause') el.pause()
      else if (next.action === 'play')
        void el.play().catch(() => {
          /* the element may have been replaced meanwhile; nothing to do */
        })
    })
  }, [background, ref])
}
