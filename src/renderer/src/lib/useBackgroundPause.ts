import { useEffect, type RefObject } from 'react'
import { usePlayerPrefs } from './playerPrefs'

/**
 * Pause when Prism is not what you are looking at.
 *
 * Two conventions exist and Prism offers both rather than inventing a third:
 * VLC pauses when the window is MINIMISED, PotPlayer when it LOSES FOCUS. Off
 * by default, which is what Prism has always done.
 *
 * The signal comes from MAIN, not from the page: Electron does not mark a
 * minimised window hidden, so `visibilitychange` never fires and
 * `document.hidden` stays false however small the window gets.
 *
 * It only pauses what was playing, and only resumes what it paused itself: a
 * film you stopped by hand stays stopped when you come back, which is the
 * whole point of having stopped it.
 */
export function useBackgroundPause(ref: RefObject<HTMLMediaElement | null>): void {
  const { background } = usePlayerPrefs()
  useEffect(() => {
    if (background === 'off') return
    let ours = false
    const away = (): void => {
      const el = ref.current
      if (!el || el.paused) return
      ours = true
      el.pause()
    }
    const back = (): void => {
      const el = ref.current
      if (!el || !ours) return
      ours = false
      void el.play().catch(() => {
        /* the element may have been replaced meanwhile; nothing to do */
      })
    }
    return window.prism.onWindowState(({ minimised, focused }) => {
      const gone = background === 'minimised' ? minimised : minimised || !focused
      if (gone) away()
      else back()
    })
  }, [background, ref])
}
