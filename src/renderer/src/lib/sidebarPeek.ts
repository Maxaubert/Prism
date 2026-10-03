// THE COLLAPSED SIDEBAR PEEKS (#250; owner, 2026-10-02: "when collapsed ...
// shows when cursor hits the edge on the side, but it would collapse again
// once the cursor moves away"). The pure half: where the pointer is, whether
// the panel is out, and which timer runs. `useSidebarPeek` feeds it pointer
// moves and timer firings and owns the DOM; nothing here touches either, so
// every rule below is a unit test.
//
// The rules:
// - Resting on the edge for DWELL opens it. A pointer that only crosses the
//   edge on its way somewhere (to a window edge to resize, to the taskbar)
//   must not throw a panel over the content, so a pass is not a rest.
// - Leaving it (to anywhere but the edge strip or the panel) closes it after
//   GRACE. A pointer that overshoots the panel's edge by a few pixels and comes
//   straight back must not watch it slide away and back.
// - It never closes while something in it is LIVE (`held`, which the hook
//   measures when the grace runs out, since a menu closing sends no pointer
//   event): it asks again one grace later, and closes only once nothing is.
// - Escape closes it unless something live is up (that Escape is the menu's
//   or the field's). Pinning, opening a file from it, or the panel no longer
//   being collapsed end it at once (`end`).

/** Where the pointer is, as far as the peek is concerned. */
export type PeekAt = 'edge' | 'panel' | 'away'

export interface PeekState {
  open: boolean
  at: PeekAt
  /** Bumped when the grace ran out while something was live, so the hook's
   *  timer runs again: the only way the state says "ask me later". */
  tick: number
  /** Sliding away after a close the POINTER caused (the grace ran out, or
   *  Escape). A pin or an opened file ends it where it stands, with no slide:
   *  the panel is either staying or the file has the window. */
  leaving: boolean
}

export type PeekEvent =
  | { type: 'move'; at: PeekAt }
  | { type: 'timer'; held: boolean }
  | { type: 'escape'; held: boolean }
  | { type: 'end' }
  /** The slide away has finished. */
  | { type: 'settled' }

/** How long the pointer rests on the edge before the panel comes out. */
export const PEEK_DWELL_MS = 150
/** How long after the pointer leaves the panel it goes away again. */
export const PEEK_GRACE_MS = 300
/** The hot strip along the window's side, in CSS pixels. Wide enough to land
 *  on without aiming (the very edge of a maximized window is a wall the pointer
 *  stops against, which is the usual way it gets there), narrow enough that a
 *  click near the side of the content is not swallowed: it is measured from
 *  pointer moves, so it takes no clicks at all. */
export const PEEK_EDGE_PX = 6

export const PEEK_IDLE: PeekState = { open: false, at: 'away', tick: 0, leaving: false }

export function peekReduce(s: PeekState, e: PeekEvent): PeekState {
  switch (e.type) {
    case 'move': {
      // A closed panel has no box to be over: whatever the hook measured, the
      // pointer is somewhere else.
      const at = !s.open && e.at === 'panel' ? 'away' : e.at
      return at === s.at ? s : { ...s, at }
    }
    case 'timer':
      if (!s.open && s.at === 'edge') return { ...s, open: true, leaving: false }
      if (s.open && s.at === 'away')
        return e.held ? { ...s, tick: s.tick + 1 } : { ...s, open: false, leaving: true }
      return s
    case 'escape':
      return s.open && !e.held ? { ...s, open: false, at: 'away', leaving: true } : s
    case 'settled':
      return s.leaving ? { ...s, leaving: false } : s
    case 'end':
      // `away` as well: a pointer still resting on the edge after a pin or an
      // Escape must MOVE to ask for the panel again, or Escape would only last
      // one dwell.
      return s.open || s.at !== 'away' || s.leaving
        ? { ...s, open: false, at: 'away', leaving: false }
        : s
  }
}

/** The timer the state wants running, in ms, or null for none. */
export function peekTimer(s: PeekState): number | null {
  if (!s.open && s.at === 'edge') return PEEK_DWELL_MS
  if (s.open && s.at === 'away') return PEEK_GRACE_MS
  return null
}

/** Which part of the window a point is in. `edge` is the strip along the
 *  panel's side of the workspace (never the chrome above it), `panel` is the
 *  peeking panel's own box. */
export function peekWhere(
  x: number,
  y: number,
  zone: { left: number; right: number; top: number; bottom: number },
  side: 'left' | 'right',
  panel: { left: number; right: number; top: number; bottom: number } | null
): PeekAt {
  if (panel && x >= panel.left && x < panel.right && y >= panel.top && y < panel.bottom) return 'panel'
  if (y < zone.top || y >= zone.bottom) return 'away'
  const inStrip = side === 'left' ? x >= zone.left && x < zone.left + PEEK_EDGE_PX : x < zone.right && x >= zone.right - PEEK_EDGE_PX
  return inStrip ? 'edge' : 'away'
}

/** Whether a point is on a native vertical scrollbar of a box: right of its
 *  content and padding, left of its right border. With the tree on the RIGHT,
 *  the content's own scrollbar (6px, `index.css`) is exactly where the hot
 *  strip is, and a pointer resting there to grab it must not have the tree
 *  thrown over it (review of #250). So the edge does not count over one; the
 *  strip still works wherever the content does not scroll, and the toggle and
 *  Ctrl+B pin as ever. */
export function onScrollbar(
  x: number,
  box: { left: number; right: number },
  clientLeft: number,
  clientWidth: number,
  borderRight: number
): boolean {
  const start = box.left + clientLeft + clientWidth
  const end = box.right - borderRight
  return end - start >= 1 && x >= start && x < end
}
