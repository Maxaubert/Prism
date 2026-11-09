import { useLayoutEffect, useMemo, useState, type RefObject } from 'react'

/**
 * A VIEWER LISTENS WHERE IT IS DRAWN (owner, 2026-11-08: "Keys and in-page
 * links don't work with focus inside the preview window ... fix that").
 *
 * The preview window's viewer is this page's React tree drawn into another
 * document through a portal (`components/previewWindow/PreviewWindow.tsx`).
 * A key pressed in that window reaches THAT window and its document only, so
 * a viewer listening on this page's `window` never heard it, and a lookup in
 * this page's `document` (markdown's #link, the focused element, the find's
 * highlights) never found what is in the window. The same family as
 * `ownResizeObserver.ts`.
 *
 * The rule: a viewer listens on the windows `viewerWindows` names, its OWN
 * window (where its element is) and this page's, the Explorer, whose list
 * keeps sending the letters it does not take to the viewer, as the pane's do.
 * Inside this page that is this window alone, exactly as before. Lookups go to
 * the element's own document. `useViewerWindows` re-binds when an element
 * moves between the two.
 */

export type OwnWindow = Window & typeof globalThis

/** The window a node lives in: its document's, or this page's when it has none. */
export function ownWindow(node: Node | null | undefined): OwnWindow {
  if (!node) return window
  const doc = node.nodeType === 9 ? (node as Document) : node.ownerDocument
  return (doc?.defaultView as OwnWindow | null | undefined) ?? window
}

/** The document a node (or an event's target) lives in. */
export function ownDocument(node: EventTarget | null | undefined): Document {
  return isNode(node) ? ownWindow(node).document : document
}

/** A node from ANY window: `instanceof Node` fails across windows (each has
 *  its own constructors). */
export function isNode(x: unknown): x is Node {
  return !!x && typeof x === 'object' && typeof (x as Node).nodeType === 'number'
}

/** An element from any window (`instanceof Element` fails across windows). */
export function isElement(x: unknown): x is Element {
  return isNode(x) && x.nodeType === 1
}

/** The windows a viewer's listeners go on: its own first, then this page's
 *  (just this page's when they are the same). */
export function viewerWindows(own: OwnWindow): OwnWindow[] {
  return own === window ? [window] : [own, window]
}

/** `addEventListener` on each window; returns the undo. */
export function listenOn<K extends keyof WindowEventMap>(
  wins: readonly OwnWindow[],
  type: K,
  listener: (e: WindowEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions
): () => void {
  for (const w of wins) w.addEventListener(type, listener, options)
  return () => {
    for (const w of wins) w.removeEventListener(type, listener, options)
  }
}

/**
 * The windows the element in `ref` listens on, kept current: read after every
 * render, so a viewer drawn into the preview window (or back) re-binds its
 * listeners, which name the result in their effect's dependencies. Stable
 * between changes. An element not drawn yet keeps the window it had.
 */
export function useViewerWindows(ref: RefObject<Node | null>): OwnWindow[] {
  const [own, setOwn] = useState<OwnWindow>(() => window)
  // After EVERY render on purpose (the ref's element can change without the
  // ref): a state set to the value it has is no update, so this settles in
  // one extra render when the window really changed and none otherwise.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (!ref.current) return
    const w = ownWindow(ref.current)
    setOwn((prev) => (prev === w ? prev : w))
  })
  return useMemo(() => viewerWindows(own), [own])
}
