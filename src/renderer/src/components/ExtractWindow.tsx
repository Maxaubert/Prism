import { useEffect, useRef, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { dispatch, failureText, middleEllipsis, useExtraction } from '../lib/extraction'
import { EXTRACT_WINDOW_ATTR } from '../lib/extractionGuard'
import { DIALOG_BODY, DIALOG_BOX, DIALOG_SCRIM, DIALOG_TITLE, dialogButton } from './dialogLook'

/**
 * THE EXTRACTION WINDOW (2026-09-19, #166).
 *
 * Owner: "When you extract something, the progress bar works differently
 * based on like how you extracted. If you click the Quick button to extract
 * from a zip or you extract all, you extract via the right click menu, there
 * are so many options to extract, and some use different methods. I would
 * like it to just be one kind of view that appears, and I want it to be a
 * pop-up window that you can't close, kind of like it is with WinRAR, where
 * you just see the progress bar, and you just have to wait until it's done
 * extracting." Asked the same day: it gets a Cancel button. No X; Escape and
 * a click outside do nothing; Cancel stops the extraction and cleans up what
 * was half written.
 *
 * Mounted ONCE, beside App (`renderApp.tsx`), and drawn for every route: it
 * reads the one store (`lib/extraction`), which hears the one channel main
 * speaks on. No route renders anything of its own, which is the only
 * arrangement in which they cannot come to look different again.
 *
 * It is the app's Dialog to look at (the same strings, imported) and not the
 * Dialog component, whose contract is the opposite one: Escape and a click
 * outside CANCEL a Dialog, and here they must do nothing.
 *
 * IT CANNOT BE DISMISSED, in three layers, because any one alone leaks:
 * the scrim covers the app and swallows the mouse; `#root` is made `inert`,
 * so nothing behind can be focused or reached by Tab or a screen reader; and
 * the key guard (`lib/extractionGuard`, installed before React) swallows the
 * keystrokes that `inert` does not stop. It is a portal on `body` for the
 * second of those: a window inside `#root` would be inert with it.
 *
 * It MOUNTS when an extraction starts and UNMOUNTS when it ends, rather than
 * fading: the transport's fullscreen lesson (2026-08-25) is that a layer
 * taken to opacity 0 is a layer still there.
 */
export function ExtractWindow(): JSX.Element | null {
  const s = useExtraction()
  const up = s.phase !== 'idle'
  const box = useRef<HTMLDivElement>(null)

  // The one listener for the one channel.
  useEffect(() => window.prism.onExtractEvent((e) => dispatch(e)), [])

  useEffect(() => {
    if (!up) return
    const root = document.getElementById('root')
    // What had the keyboard gets it back afterwards: a tree row, usually, so
    // the arrows carry on from where the verb was picked.
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null
    root?.setAttribute('inert', '')
    // Focus lands on the BOX, not on Cancel: the verb is very often picked
    // with Enter, and a key still held (or pressed again out of habit) must
    // not be what cancels the extraction it just started.
    box.current?.focus()
    return () => {
      root?.removeAttribute('inert')
      if (before?.isConnected) before.focus()
    }
  }, [up])

  if (s.phase === 'idle') return null

  const failed = s.phase === 'failed'
  const pct = failed ? null : s.pct
  const title = failed ? `Couldn't extract ${s.archive}` : `Extracting ${s.archive}`

  return createPortal(
    <div
      // App's Escape handler yields to anything that owns the key. The guard
      // has already swallowed it by then; this is the second lock.
      data-owns-escape
      className={DIALOG_SCRIM.replace('z-50', 'z-[90]')}
      role="presentation"
      // A press on the scrim does nothing, and does not take the focus off
      // the box either (which is what would let Tab wander nowhere).
      onMouseDown={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
      // A file dropped on the window means "open this" to App, which listens
      // on `window`. Not while the app is busy.
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <div
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        {...{ [EXTRACT_WINDOW_ATTR]: '' }}
        data-phase={s.phase}
        data-extract-pct={pct === null ? '' : Math.round(pct)}
        className={`${DIALOG_BOX} outline-none`}
      >
        <h2 className={`${DIALOG_TITLE} truncate`} title={s.archive}>
          {title}
        </h2>
        {failed ? (
          <div data-extract-error className={`${DIALOG_BODY} break-words`}>
            {failureText(s.reason, s.message)}
          </div>
        ) : (
          <>
            {/* Always a line, even with no destination to name, so the bar
                sits where it sits whichever route opened the window. */}
            <div
              data-extract-dest
              className="mt-1 h-[18px] truncate text-[12px] leading-[18px] text-[var(--p-dim)]"
              title={s.dest}
            >
              {s.dest ? `to ${middleEllipsis(s.dest, 52)}` : ' '}
            </div>
            <div className="mt-4 flex items-center gap-3">
              {/* No width transition, the chip's rule: the fill only ever
                  grows, and an engine that has not spoken yet pulses the
                  TRACK with an empty fill rather than showing a block the
                  first real number would then shrink from. */}
              <span
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct === null ? undefined : Math.round(pct)}
                className={`block h-[6px] flex-1 overflow-hidden rounded-full bg-[var(--p-track)] ${
                  pct === null ? 'animate-pulse' : ''
                }`}
              >
                <span
                  data-extract-fill
                  className="block h-full rounded-full bg-[var(--p-accent)]"
                  style={{ width: pct === null ? '0%' : `${Math.max(1, pct)}%` }}
                />
              </span>
              {/* A fixed box, so the bar does not change length as the
                  number gains a digit. */}
              <span className="w-[36px] shrink-0 text-right font-mono text-[11.5px] leading-none text-[var(--p-text-soft)]">
                {pct === null ? '' : `${Math.round(pct)}%`}
              </span>
            </div>
            {/* The member being written. Shortened in the MIDDLE, because the
                end of a path is the file's own name and the end is what CSS
                would cut. A fixed height, so an empty one moves nothing. */}
            <div
              data-extract-file
              className="mt-2 h-[16px] truncate text-[11.5px] leading-[16px] text-[var(--p-dim2)]"
              title={s.file}
            >
              {s.phase === 'cancelling'
                ? 'Cancelling, and removing what was written…'
                : s.file
                  ? middleEllipsis(s.file, 58)
                  : ' '}
            </div>
          </>
        )}
        <div className="mt-5 flex justify-end gap-2">
          {/* KEYED, so Close is a new element and not Cancel restyled: the
              shared button classes carry `transition-colors`, and the same
              node changing class faded its label from Cancel's grey to
              Close's colour, which the e2e's screenshot caught half way as
              grey text on the accent. */}
          {failed ? (
            <button
              key="close"
              data-extract-close
              className={dialogButton({ primary: true })}
              onClick={() => dispatch({ type: 'dismiss' })}
            >
              Close
            </button>
          ) : (
            <button
              key="cancel"
              data-extract-cancel
              // A request: the window stays, saying so, until main reports
              // the process gone and the half-written files removed.
              disabled={s.phase !== 'running'}
              className={`${dialogButton({})} disabled:cursor-default disabled:opacity-50 disabled:hover:text-[var(--p-text-soft)]`}
              onClick={() => {
                dispatch({ type: 'cancel-asked' })
                void window.prism.extractCancel(s.id)
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
