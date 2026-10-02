import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from 'react'
import { PEEK_IDLE, onScrollbar, peekReduce, peekTimer, peekWhere } from './sidebarPeek'

/** How long a peek takes to slide away, matching the panels' own 180ms slide. */
const OUT_MS = 180

/** What App hands the hook: whether a collapsed panel is there to peek, which
 *  side it lives on, and how to find the two boxes the pointer is measured
 *  against. `target` names WHICH panel (the project tree or the Explorer's
 *  places), so moving from one to the other ends a peek rather than carrying
 *  it across. */
export interface PeekOptions {
  target: string | null
  side: 'left' | 'right'
  /** The workspace under the chrome: the hot strip runs down its side. */
  zone: () => HTMLElement | null
  /** The peeking panel's own box, while it is out. */
  panel: () => HTMLElement | null
}

/** 'in' while the panel is out, 'out' for the slide away, null otherwise. */
export type PeekPhase = 'in' | 'out' | null

/** Whether a point is on a scrollbar: a native one on the element under it or
 *  any box round it, or xterm's own slider (a terminal hides the native bar
 *  and draws its own). See `onScrollbar`. */
const overScrollbar = (x: number, y: number): boolean => {
  const hit = document.elementFromPoint(x, y)
  if (!hit) return false
  if (hit.closest('.xterm .scrollbar')) return true
  for (let el: Element | null = hit; el && el !== document.body; el = el.parentElement) {
    if (el.scrollHeight <= el.clientHeight) continue
    const css = getComputedStyle(el)
    if (
      onScrollbar(x, el.getBoundingClientRect(), el.clientLeft, el.clientWidth, parseFloat(css.borderRightWidth) || 0)
    )
      return true
  }
  return false
}

const stillMotion = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * The DOM half of the peek (#250): it measures the pointer against the edge
 * strip and the panel, runs the reducer's timers, and decides what is LIVE.
 * Live, so the peek never closes under it:
 * - an open menu or dialog anywhere (a context menu, the sort menu, a delete
 *   question): while a peek is out, that is what the user is working in;
 * - a text field inside the panel holding the focus AND some text (a rename
 *   field always does; the search box only once something is typed, since an
 *   empty box that merely has the caret is not work in progress);
 * - a press that began inside the panel and has not been let go (dragging its
 *   edge to resize, selecting text in a field);
 * - an HTML drag in flight (a row being carried out of the tree), during
 *   which Chromium sends no pointer moves at all.
 * The peek takes no focus: it is a pointer convenience, and the keyboard pins
 * the panel with Ctrl+B as before. But a click in it (a folder row) does put
 * the focus there, and the panel going inert as it slides away would drop it
 * on the body, where the keys reach nothing (review of #250). So a close with
 * the focus inside hands it back to whatever had it before the panel did.
 */
export function useSidebarPeek({ target, side, zone, panel }: PeekOptions): {
  phase: PeekPhase
  /** End it now, with no slide (a pin, a file opened from it). */
  end: () => void
} {
  const [state, send] = useReducer(peekReduce, PEEK_IDLE)
  const pressing = useRef(false)
  const dragging = useRef(false)
  // Where the focus was before it went into the panel, and whether it is in
  // there now. Tracked from focusin, since the inert panel blurs to the body
  // without a focusin anywhere.
  const before = useRef<HTMLElement | null>(null)
  const focusIn = useRef(false)
  // The newest finders, read by listeners that live across renders.
  const live = useRef(zone)
  const box = useRef(panel)
  // Whether the panel is out: only then is its box a place to be. A collapsed
  // panel can still have a box while it slides shut after Ctrl+B, and a point
  // inside it then is the edge, not the panel.
  const out = useRef(false)
  useLayoutEffect(() => {
    live.current = zone
    box.current = panel
    out.current = state.open
  })

  const held = useCallback((): boolean => {
    if (pressing.current || dragging.current) return true
    if (document.querySelector('[role="menu"],[role="dialog"]')) return true
    const el = box.current()
    const a = document.activeElement
    return (
      !!el &&
      !!a &&
      el.contains(a) &&
      (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement) &&
      a.value.trim() !== ''
    )
  }, [])

  const end = useCallback(() => send({ type: 'end' }), [])

  // A different panel (or none) ends whatever was out, at once.
  useEffect(() => {
    send({ type: 'end' })
  }, [target])

  useEffect(() => {
    if (!target) return
    const where = (x: number, y: number): void => {
      const z = live.current()
      if (!z) return
      const p = out.current ? box.current() : null
      const at = peekWhere(x, y, z.getBoundingClientRect(), side, p ? p.getBoundingClientRect() : null)
      send({ type: 'move', at: at === 'edge' && overScrollbar(x, y) ? 'away' : at })
    }
    const move = (e: PointerEvent): void => {
      // Chromium sends no pointer events during an HTML drag, so any move
      // means it is over, even when its dragend went to a row the tree had
      // already unmounted and never reached the window (review of #250).
      dragging.current = false
      // A press that began in the panel keeps it, wherever the pointer goes.
      if (pressing.current) return
      // A press that began ANYWHERE else (selecting text in the editor and
      // drifting left) is not a rest on the edge: no dwell with a button down.
      if (e.buttons !== 0) {
        send({ type: 'move', at: 'away' })
        return
      }
      where(e.clientX, e.clientY)
    }
    const down = (e: PointerEvent): void => {
      dragging.current = false
      const p = box.current()
      pressing.current = !!p && e.target instanceof Node && p.contains(e.target)
    }
    const up = (e: PointerEvent): void => {
      if (!pressing.current) return
      pressing.current = false
      where(e.clientX, e.clientY)
    }
    // Out of the window altogether is away: no move is sent for it.
    const leave = (): void => send({ type: 'move', at: 'away' })
    const dragOn = (): void => {
      dragging.current = true
    }
    const dragOff = (): void => {
      dragging.current = false
    }
    const focus = (e: FocusEvent): void => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      const p = box.current()
      if (p && p.contains(t)) focusIn.current = true
      else {
        focusIn.current = false
        before.current = t
      }
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') send({ type: 'escape', held: held() })
    }
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    document.documentElement.addEventListener('mouseleave', leave)
    window.addEventListener('dragstart', dragOn, true)
    window.addEventListener('dragend', dragOff, true)
    window.addEventListener('drop', dragOff, true)
    window.addEventListener('keydown', key)
    window.addEventListener('focusin', focus, true)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
      document.documentElement.removeEventListener('mouseleave', leave)
      window.removeEventListener('dragstart', dragOn, true)
      window.removeEventListener('dragend', dragOff, true)
      window.removeEventListener('drop', dragOff, true)
      window.removeEventListener('keydown', key)
      window.removeEventListener('focusin', focus, true)
      pressing.current = false
      dragging.current = false
    }
  }, [target, side, held])

  // The one timer the state asks for: the dwell, or the grace.
  const wait = peekTimer(state)
  useEffect(() => {
    if (wait === null || !target) return
    const t = window.setTimeout(() => send({ type: 'timer', held: held() }), wait)
    return () => window.clearTimeout(t)
  }, [wait, state.at, state.open, state.tick, target, held])

  // A close the pointer or Escape caused, with the focus in the panel (or
  // already blurred to the body by its going inert): the focus goes back to
  // where it was, else into the content, never nowhere. In a layout effect so
  // it lands before a key can be pressed into the void.
  useLayoutEffect(() => {
    if (!state.leaving || !focusIn.current) return
    focusIn.current = false
    const p = box.current()
    const a = document.activeElement
    if (a && a !== document.body && !(p && p.contains(a))) return
    const back = before.current
    if (back && back.isConnected && !(p && p.contains(back)) && !back.closest('[inert]')) {
      back.focus({ preventScroll: true })
      return
    }
    live
      .current()
      ?.querySelector<HTMLElement>('textarea, [tabindex="0"], input, button')
      ?.focus({ preventScroll: true })
  }, [state.leaving])

  // The slide away: kept on screen, inert, for one slide. A reduced-motion
  // setting has no slide, so it settles at once.
  useEffect(() => {
    if (!state.leaving) return
    const t = window.setTimeout(() => send({ type: 'settled' }), stillMotion() ? 0 : OUT_MS)
    return () => window.clearTimeout(t)
  }, [state.leaving])

  const phase: PeekPhase = !target ? null : state.open ? 'in' : state.leaving ? 'out' : null
  return { phase, end }
}
