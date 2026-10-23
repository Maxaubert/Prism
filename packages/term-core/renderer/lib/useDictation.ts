import { useEffect, useRef, useSyncExternalStore } from 'react'
import { armDictation, dictationView, onDictationView, type DictationView } from './dictation'

/**
 * Arm dictation for this window (#13). Mounted ONCE, by the host's App, with
 * the session in front. It returns nothing on purpose: what dictation is doing
 * is read where it is drawn (`useDictationView`, in the pill and the tab
 * strip), so speaking never re-renders the app shell.
 */
export function useDictationArm(activeSessionId: string | null): void {
  const active = useRef(activeSessionId)
  useEffect(() => {
    active.current = activeSessionId
  }, [activeSessionId])
  useEffect(() => armDictation(() => active.current), [])
}

export function useDictationView(): DictationView {
  return useSyncExternalStore(onDictationView, dictationView)
}
