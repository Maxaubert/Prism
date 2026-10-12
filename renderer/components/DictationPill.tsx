import { useEffect, useRef, type JSX } from 'react'
import { onDictationLevel } from '../lib/dictation'
import { useDictationView } from '../lib/useDictation'
import { LAYER } from './layers'

/**
 * What dictation is doing, over the terminal it is dictating into (#13).
 *
 * ONE capsule, bottom centre, three faces: listening (a live meter and the
 * provisional words), transcribing, and a short message when something needs
 * saying ("No microphone found"). The owner's complaint about every other
 * dictation tool is the reason for the first face: "you see no text before you
 * stop, so if your mic's off you won't know until you finish". The METER moves
 * the moment sound arrives, before any model has answered, so a dead
 * microphone is visible in the first half second.
 *
 * It MOUNTS and UNMOUNTS (no fade held at opacity 0): an idle terminal carries
 * no dictation DOM at all. It is absolutely positioned inside the host's
 * terminal box and never takes layout, so the shell's rows do not move when it
 * appears (measured in the e2e). The ground is `--p-side-flat`, the OPAQUE
 * surface both apps define, because the terminal under it may be acrylic and a
 * capsule you can read the prompt through is a smear.
 *
 * The meter is written straight to the DOM from the level callback: it moves
 * at frame rate, and React has no business re-rendering for it.
 */
const BARS = [0.55, 0.85, 1, 0.8, 0.5] as const

export function DictationPill({ sessionId }: { sessionId: string | null }): JSX.Element | null {
  const view = useDictationView()
  const bars = useRef<Array<HTMLSpanElement | null>>([])
  const listening = view.phase === 'listening'

  useEffect(() => {
    if (!listening) return
    let shown = 0
    return onDictationLevel((level) => {
      // Fast up, slow down: speech is spiky, and a meter that falls as fast as
      // it rises flickers instead of reading as loudness.
      shown = level > shown ? level : shown * 0.82 + level * 0.18
      bars.current.forEach((el, i) => {
        if (el) el.style.transform = `scaleY(${Math.max(0.12, Math.min(1, shown * BARS[i] * 1.25))})`
      })
    })
  }, [listening])

  // Drawn over the session being dictated into, and for a message over
  // whichever terminal is in front.
  const mine = view.phase === 'idle' ? view.message !== null : view.sessionId === sessionId
  if (!mine) return null

  // The engine still starting is said as that, never as "Transcribing"
  // (2026-09-28): the owner read half a minute of it as a hang.
  const label =
    view.phase === 'listening'
      ? 'Listening…'
      : view.phase === 'transcribing'
        ? view.starting
          ? 'Starting speech engine…'
          : 'Transcribing…'
        : view.message

  return (
    <div
      data-dictation-pill={view.phase}
      role="status"
      aria-live="polite"
      className={`pointer-events-none absolute inset-x-0 bottom-4 ${LAYER.panel} flex justify-center px-6`}
    >
      <div className="flex max-w-[min(680px,100%)] items-center gap-2.5 rounded-full border border-[color:var(--p-divider)] bg-[var(--p-side-flat)] py-1.5 pl-3 pr-4 shadow-[0_6px_24px_rgba(0,0,0,0.35)]">
        {listening ? (
          <span aria-hidden="true" className="flex h-4 shrink-0 items-center gap-[3px]">
            {BARS.map((_, i) => (
              <span
                key={i}
                ref={(el) => {
                  bars.current[i] = el
                }}
                data-dictation-bar
                className="block h-4 w-[3px] origin-center rounded-full bg-[var(--p-accent-hi)]"
                style={{ transform: 'scaleY(0.12)', transition: 'transform 70ms linear' }}
              />
            ))}
          </span>
        ) : view.phase === 'transcribing' ? (
          <span aria-hidden="true" className="block animate-spin h-3.5 w-3.5 shrink-0 rounded-full border-2 border-[color:var(--p-divider)] border-t-[color:var(--p-accent-hi)]" />
        ) : null}
        <span className="shrink-0 text-[12.5px] font-semibold text-[var(--p-text)]">{label}</span>
        {listening && !view.liveText && view.starting && (
          <span data-dictation-starting className="shrink-0 text-[12.5px] text-[var(--p-dim)]">
            Starting speech engine
          </span>
        )}
        {listening && view.liveText && (
          // The NEWEST words matter: the line is clipped from the left, so what
          // you just said is always the part you can see.
          <span
            data-dictation-live
            dir="rtl"
            className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] text-[var(--p-dim)]"
          >
            <bdi dir="ltr">{view.liveText}</bdi>
          </span>
        )}
      </div>
    </div>
  )
}
