/**
 * A ResizeObserver from the element's OWN window (review 2026-11-08, the
 * preview window). The preview window's viewer is this page's React tree
 * drawn into another document through a portal, and an observer made from
 * this window never reports an element of that one (measured in the
 * previewWindow e2e: none of its callbacks came, so a picture fitted to a
 * stage of 0x0 and stayed invisible). Made from the element's own window it
 * reports as usual; an element of this document gets this window's observer,
 * the same as before.
 */
export function ownResizeObserver(el: Element, callback: ResizeObserverCallback): ResizeObserver {
  const own = el.ownerDocument?.defaultView as (Window & typeof globalThis) | null | undefined
  const Observer = own?.ResizeObserver ?? ResizeObserver
  return new Observer(callback)
}
