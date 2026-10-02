import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from 'react'
import { PEEK_IDLE, peekReduce, peekTimer, peekWhere } from './sidebarPeek'

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
 * The peek takes no focus and gives none back: it is a pointer convenience,
 * and the keyboard pins the panel with Ctrl+B as before.
 */
export function useSidebarPeek({ target, side, zone, panel }: PeekOptions): {
  phase: PeekPhase
  /** End it now, with no slide (a pin, a file opened from it). */
  end: () => void
} {
  const [state, send] = useReducer(peekReduce, PEEK_IDLE)
  const pressing = useRef(false)
  const dragging = useRef(false)
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
      send({
        type: 'move',
        at: peekWhere(x, y, z.getBoundingClientRect(), side, p ? p.getBoundingClientRect() : null)
      })
    }
    const move = (e: PointerEvent): void => {
      // A press that began in the panel keeps it, wherever the pointer goes.
      if (pressing.current) return
      where(e.clientX, e.clientY)
    }
    const down = (e: PointerEvent): void => {
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
