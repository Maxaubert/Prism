import type { JSX } from 'react'
import { useDictationView } from '../lib/useDictation'

/**
 * The mic mark on the tab being dictated into (#13). The pill says what
 * dictation is doing; this says WHERE the words will land, which matters the
 * moment you switch tabs mid-sentence: the paste still goes to the tab you
 * started in, and this is how you can tell.
 *
 * It reads the dictation store itself, so a host's tab strip drops it in
 * beside a label and passes nothing but the session: the strip does not
 * re-render when someone starts to speak, only this does.
 */
export function DictationTabMark({ sessionId }: { sessionId: string }): JSX.Element | null {
  const view = useDictationView()
  if (view.phase === 'idle' || view.sessionId !== sessionId) return null
  return (
    <svg
      data-dictation-mark
      viewBox="0 0 24 24"
      width={13}
      height={13}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-[var(--p-accent-hi)]"
      aria-label={view.phase === 'listening' ? 'Listening' : 'Transcribing'}
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </svg>
  )
}
