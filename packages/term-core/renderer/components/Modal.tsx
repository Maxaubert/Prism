import { useEffect, useRef, useState, type CSSProperties, type JSX, type ReactNode, type RefObject } from 'react'
import { LAYER } from './layers'

/**
 * EVERY POPUP DIALOG IN BOTH APPS (audit 2026-10-12: six dialogs each wrote
 * their own scrim, Escape, focus and Tab handling, and they had drifted: the
 * close question had no Tab trap and no `no-drag`). One frame, so a rule set
 * here holds for all of them:
 *
 * - ESCAPE is heard from the window in the capture phase and swallowed, so a
 *   host's own Escape stays down; it cancels unless `locked` (an install that
 *   is running). An Escape aimed at a colour picker inside is the picker's (#112).
 * - TAB STAYS INSIDE. Behind this is a terminal, and a Tab that wandered out
 *   would be typed into somebody's shell. A PLAIN Tab only: Ctrl+Tab is the
 *   host's chord (it steps the tabs), and both listeners sit on the window in
 *   the capture phase, so without this test one press did both.
 * - A PRESS OUTSIDE cancels (unless `locked`). `no-drag` over the whole window:
 *   the title bar and the tab strip are window-drag regions, and Chromium hands
 *   those presses to the OS, so a press there never reached the scrim.
 * - FOCUS lands on `focus` (the primary action by default), again whenever
 *   `focusKey` changes, and goes back to where it came from on close.
 * - THE LISTENERS ARE REGISTERED ONCE and read the latest callbacks through a
 *   ref. Keyed on an inline callback they were torn down and put back on every
 *   render, and when another keydown listener set state during the same Escape
 *   React swapped them mid-dispatch and Escape did nothing (MEASURED in the
 *   updateGuard e2e, 2026-09-20, about one run in five).
 * - `data-owns-escape` is the marker Prism's window Escape yields to.
 */
/** The focus goes back on close only when it went down with this dialog (to
 *  the body). Another dialog that opened meanwhile keeps it: the update window
 *  giving way to the close question handed the focus back behind the question
 *  (the updateGuard e2e, two runs in three, 2026-10-12; Prism's terminal gate
 *  on every core-v0.34 bump). */
export function returnsFocus(
  before: { isConnected: boolean } | null,
  active: unknown,
  body: unknown
): boolean {
  return !!before && before.isConnected === true && before !== body && (active === null || active === body)
}

export function Modal({
  onCancel,
  locked = false,
  label,
  labelledBy,
  describedBy,
  role = 'dialog',
  focus = '[data-primary="true"]',
  focusKey,
  scrim = 'bg-black/50 backdrop-blur-[2px]',
  shadow = true,
  scrimAttrs,
  boxAttrs,
  boxClassName = '',
  boxStyle,
  boxRef,
  onKeyDown,
  children
}: {
  onCancel: () => void
  /** Escape and a press outside do nothing (still swallowed). */
  locked?: boolean
  label?: string
  labelledBy?: string
  describedBy?: string
  role?: 'dialog' | 'alertdialog'
  /** A selector inside the box to focus on open; the box itself when none. */
  focus?: string
  /** Focus again when this changes (a new question in the same dialog). */
  focusKey?: unknown
  /** The scrim's tint and blur. */
  scrim?: string
  /** The box's drop shadow. Off where the owner's popup rule holds (a popup
   *  blurs what is behind it and casts no shadow, 2026-09-22). */
  shadow?: boolean
  scrimAttrs?: Record<string, string | boolean | undefined>
  boxAttrs?: Record<string, string | boolean | undefined>
  /** The box's size, padding and layout; its surface is the frame's own. */
  boxClassName?: string
  boxStyle?: CSSProperties
  boxRef?: RefObject<HTMLDivElement | null>
  /** Keys the dialog reads itself (a list's arrows), after Escape and Tab. */
  onKeyDown?: (e: KeyboardEvent) => void
  children: ReactNode
}): JSX.Element {
  const own = useRef<HTMLDivElement>(null)
  const box = boxRef ?? own
  // Where the focus was BEFORE this opened: read while rendering, since the
  // focus effect below moves it inside before any later effect could look.
  const [before] = useState(() => document.activeElement as HTMLElement | null)
  const live = useRef({ onCancel, locked, onKeyDown })
  useEffect(() => {
    live.current = { onCancel, locked, onKeyDown }
  })

  useEffect(() => {
    const el = box.current
    if (!el) return
    // A colour picker opened again inside it as it mounted keeps the focus.
    if (document.activeElement?.closest('[data-colour-popover]') && el.contains(document.activeElement)) return
    ;(el.querySelector<HTMLElement>(focus) ?? el).focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const inPopover = !!(e.target as Element | null)?.closest?.('[data-colour-popover]')
      if (e.key === 'Escape') {
        if (inPopover) return
        e.stopPropagation()
        e.preventDefault()
        if (!live.current.locked) live.current.onCancel()
        return
      }
      if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey && !inPopover) {
        const stops = tabStops(box.current)
        if (stops.length) {
          const at = stops.indexOf(document.activeElement as HTMLElement)
          const next = at < 0 ? 0 : (at + (e.shiftKey ? -1 : 1) + stops.length) % stops.length
          e.preventDefault()
          e.stopPropagation()
          stops[next].focus()
        }
        return
      }
      live.current.onKeyDown?.(e)
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      if (before && returnsFocus(before, document.activeElement, document.body)) before.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      data-owns-escape
      data-modal-scrim
      {...scrimAttrs}
      role="presentation"
      className={`no-drag fixed inset-0 ${LAYER.modal} grid place-items-center p-6 ${scrim}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !live.current.locked) live.current.onCancel()
      }}
    >
      <div
        ref={box}
        data-modal
        {...boxAttrs}
        role={role}
        aria-modal="true"
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        style={boxStyle}
        className={`rounded-[var(--p-radius)] border border-[color:var(--p-divider)] bg-[var(--p-side-flat)] ${shadow ? 'shadow-[0_24px_70px_rgba(0,0,0,.6)]' : ''} focus:outline-none ${boxClassName}`}
      >
        {children}
      </div>
    </div>
  )
}

/** What Tab may land on inside the box, in order. */
function tabStops(box: HTMLElement | null): HTMLElement[] {
  if (!box) return []
  return [
    ...box.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]'
    )
  ]
}
