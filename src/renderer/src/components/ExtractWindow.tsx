import { useEffect, useLayoutEffect, useRef, type JSX, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { dispatch, failureText, fitPath, useExtraction } from '../lib/extraction'
import { EXTRACT_WINDOW_ATTR } from '../lib/extractionGuard'
import { DIALOG_BOX, DIALOG_SCRIM, dialogButton } from './dialogLook'

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
 * THE OPEN SHEET (#336; owner, 2026-10-09, picking B of round 2's four:
 * "clean, fits every theme, minimal text": the bar, the percentage, one live
 * line naming the file being extracted right now, WinRAR style, and Cancel).
 * No title and no caption: the archive's name is only the window's tooltip
 * and its accessible label. The top row is the percentage, large and in a
 * regular weight, with Cancel; the bar is a 12px recessed well, the widest
 * and thickest thing in it; under it the file line. Every height is fixed, so
 * nothing moves as the number gains a digit or the file line ticks. Mockups:
 * research/prism/mockups/2026-10-09-extract-dialog/round2.
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

// The sheet's own width and padding (B: 456px, 20px top and bottom, 22px at
// the sides), on the shared dialog look so the border, ground and shadow
// cannot drift from every other question box.
const SHEET_BOX = DIALOG_BOX.replace('max-w-[420px]', 'max-w-[456px]').replace(
  ' p-5',
  ' px-[22px] py-5'
)

// The stopped fill (a failure): HATCHED in --p-dim rather than turned orange.
// In Sand the warning ink is the accent's own hue, so an orange stop read as
// progress; a texture differs from the solid fill in every theme, Midnight HC
// included, where the accent and --p-dim are both near white.
const STOPPED_FILL = 'repeating-linear-gradient(-45deg, var(--p-dim) 0 3px, transparent 3px 6px)'

/** One canvas for measuring the file line, made on first use. */
let measureCtx: CanvasRenderingContext2D | null | undefined
function measurer(): CanvasRenderingContext2D | null {
  if (measureCtx === undefined) measureCtx = document.createElement('canvas').getContext('2d')
  return measureCtx
}

/**
 * The file line, fitted to its own width in its own font: the middle of the
 * path goes and the file's name stays. Written straight into the node in a
 * layout effect (React renders no children there), before the frame paints,
 * so the unfitted path is never seen. A fit is a handful of canvas measures.
 * No throttle of our own: main already sends at most one progress every 60ms
 * (`PROGRESS_EVERY_MS`), which is under one render per frame.
 */
function useFittedLine(
  el: RefObject<HTMLDivElement | null>,
  up: boolean,
  text: string,
  fit: boolean
): void {
  // What the line says now, for the resize observer, which outlives a tick.
  const latest = useRef({ text, fit })
  // The line's font, read once per opening and again on a resize: a
  // getComputedStyle per tick is a style flush per tick.
  const font = useRef('')
  // Every tick: one fit, nothing else. The observer is NOT rebuilt here, as
  // it was at first: a new observer fires once on observe, which fitted every
  // tick twice and churned an observer per progress event.
  useLayoutEffect(() => {
    latest.current = { text, fit }
    const node = el.current
    if (node) writeLine(node, text, fit, font)
  }, [el, up, text, fit])
  // A narrower window (or a zoom that changes the box) refits it. One
  // observer per opening; its first call, at the width just fitted, is skipped.
  useLayoutEffect(() => {
    const node = el.current
    if (!node || !up) return
    font.current = ''
    let width = node.clientWidth
    const ro = new ResizeObserver(() => {
      if (node.clientWidth === width) return
      width = node.clientWidth
      font.current = ''
      writeLine(node, latest.current.text, latest.current.fit, font)
    })
    ro.observe(node)
    return () => ro.disconnect()
  }, [el, up])
}

function writeLine(
  node: HTMLElement,
  text: string,
  fit: boolean,
  font: { current: string }
): void {
  const ctx = fit && text ? measurer() : null
  const width = node.clientWidth - 1
  if (!ctx || width <= 0) {
    node.textContent = text
    return
  }
  if (!font.current) {
    const cs = getComputedStyle(node)
    font.current = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
  }
  ctx.font = font.current
  node.textContent = fitPath(text, (s) => ctx.measureText(s).width <= width)
}

export function ExtractWindow(): JSX.Element | null {
  const s = useExtraction()
  const up = s.phase !== 'idle'
  const box = useRef<HTMLDivElement>(null)
  const line = useRef<HTMLDivElement>(null)

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

  // THE KEYBOARD MUST NOT BE LEFT OUTSIDE. Cancel and Close are two elements
  // (keyed, see below), so somebody who had Tabbed onto Cancel when the
  // extraction failed was left with the focus on `body`: the button they were
  // on had gone. From there the key guard swallows Tab, Enter and Space alike,
  // since it lets them through only when they are aimed INSIDE the window, and
  // the error could then be closed with a mouse and with nothing else. So at
  // every change of phase the focus is brought back to the box if it is not
  // already somewhere inside it. The box and not Close, for the reason above:
  // a held Enter must not be what dismisses an error nobody has read yet.
  useEffect(() => {
    if (s.phase === 'idle') return
    const el = box.current
    if (el && !el.contains(document.activeElement)) el.focus()
  }, [s.phase])

  const failed = s.phase === 'failed'
  const cancelling = s.phase === 'cancelling'
  // The file line: the member being written, "Cancelling" while main cleans
  // up, or the reason once it failed. Only a member path is fitted.
  const lineText =
    s.phase === 'idle'
      ? ''
      : failed
        ? failureText(s.reason, s.message)
        : cancelling
          ? 'Cancelling'
          : s.file
  useFittedLine(line, up, lineText, s.phase === 'running' || s.phase === 'leaving')

  if (s.phase === 'idle') return null

  const pct = s.pct
  const shown = pct === null ? null : Math.floor(pct)
  const label = failed
    ? `Couldn't extract ${s.archive}`
    : s.dest
      ? `Extracting ${s.archive} to ${s.dest}`
      : `Extracting ${s.archive}`

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
        aria-label={label}
        // The archive's name is drawn nowhere (no title, no caption): it is
        // here, on the pointer, and in the label a screen reader says.
        title={s.archive}
        {...{ [EXTRACT_WINDOW_ATTR]: '' }}
        data-phase={s.phase}
        data-extract-pct={failed || shown === null ? '' : shown}
        className={`${SHEET_BOX} outline-none`}
      >
        {/* The top row: the number (or, failed, the heading) and the one
            button. A fixed 40px, so the empty number before 7-Zip has said
            anything, a third digit and the heading all take the same room. */}
        <div className="grid h-[40px] grid-cols-[1fr_auto] items-end gap-4">
          <div
            data-extract-number
            className="min-w-0 truncate pb-[1px] tabular-nums leading-none text-[var(--p-text)]"
            aria-hidden={failed ? undefined : true}
          >
            {failed ? (
              <span className="text-[17px] font-semibold">Couldn&apos;t extract</span>
            ) : shown === null ? null : (
              <span className="text-[34px] font-normal tracking-[-0.02em]">
                {shown}
                <small className="ml-px text-[17px] font-normal text-[var(--p-text-soft)]">%</small>
              </span>
            )}
          </div>
          {/* KEYED, so Close is a new element and not Cancel restyled: the
              shared button classes carry `transition-colors`, and the same
              node changing class faded its label from Cancel's grey to
              Close's colour, which the e2e's screenshot caught half way as
              grey text on the accent. */}
          {failed ? (
            <button
              key="close"
              data-extract-close
              // A text-bearing accent fill is --p-sel-bg with --p-on-accent
              // (the accent moved until its label clears 4.5:1, the update
              // chip's pair), not the raw accent, which is held only to 3:1.
              className={`${dialogButton({ primary: true }).replace(
                'bg-[var(--p-accent)]',
                'bg-[var(--p-sel-bg)]'
              )}`}
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
        {/* The WELL: a recessed track in --p-control with a --p-dim2 edge (3:1
            or more on the panel in every theme), the fill in
            --p-accent-solid (3:1 or more on --p-control). Corners are the
            theme's own radius: a pill in a square-cornered theme read as a
            part from another app. No width transition, the chip's rule: the
            fill only ever grows, and before the engine has spoken the well is
            simply empty rather than showing a block the first real number
            would shrink from. */}
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={shown === null ? undefined : shown}
          aria-label={failed ? 'Stopped' : 'Extracting'}
          data-extract-well
          data-stopped={failed ? '' : undefined}
          className="relative mt-[14px] h-[12px] overflow-hidden rounded-[var(--p-radius)] bg-[var(--p-control)] shadow-[inset_0_0_0_1px_var(--p-dim2)]"
        >
          <span
            data-extract-fill
            className="absolute inset-y-0 left-0 block rounded-[var(--p-radius)]"
            style={{
              width: pct === null ? '0%' : `${Math.max(1, pct)}%`,
              background: failed ? STOPPED_FILL : 'var(--p-accent-solid)',
              boxShadow: failed ? 'inset 0 0 0 1px var(--p-dim)' : undefined
            }}
          />
        </div>
        {/* The file line. A fixed 18px while it runs, so an empty one moves
            nothing; the member's text is written by `useFittedLine`. A
            failure's reason may need a second line and gets it. */}
        <div
          ref={line}
          data-extract-file={failed ? undefined : ''}
          data-extract-error={failed ? '' : undefined}
          className={`mt-[10px] text-[12.5px] leading-[18px] tabular-nums text-[var(--p-dim)] ${
            failed ? 'min-h-[18px] break-words' : 'h-[18px] overflow-hidden whitespace-nowrap'
          }`}
          title={failed || cancelling ? undefined : s.file || undefined}
        />
      </div>
    </div>,
    document.body
  )
}
