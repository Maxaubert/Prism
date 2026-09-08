/**
 * Fullscreen, three ways (2026-09-07, #107, owner: "i cant go fullscreen in
 * the player on mobile"). The phone page asked for `requestFullscreen` on
 * the document element and nothing else, and its own comment admitted what
 * that costs: WEBKIT ON AN IPHONE HAS NO ELEMENT AND NO DOCUMENT FULLSCREEN
 * API AT ALL. Not prefixed, not disabled, absent - the only fullscreen an
 * iPhone has is the media element's OWN native player, entered with
 * `webkitEnterFullscreen()` and reported by `webkitDisplayingFullscreen`.
 * So the button was dead on exactly the device most likely to press it.
 *
 * The three routes, in the order a host is asked for them:
 *  1. the standard API on an element (Chrome, Edge, Firefox, Safari on a Mac),
 *  2. the older prefixed `webkitRequestFullscreen` on an element (an iPad,
 *     and WebKit builds that never took the unprefixed name),
 *  3. the media element's iOS-only native player.
 * The page's own fullscreen is preferred wherever it exists, and that is a
 * decision rather than an ordering accident: the OS player draws its own
 * transport over everything, so on a host that can fullscreen the PAGE the
 * OS player would hide Prism's transport, the target control and the way
 * back to the folder.
 *
 * Everything here takes its elements as ARGUMENTS and reaches for no global:
 * the document comes from `container.ownerDocument`, which is what lets the
 * whole thing be tested under node against plain objects, and what keeps the
 * branch-picking honest rather than eyeballed on one device.
 */

/** Only the parts of a document the routes touch. A real `Document` is one;
 *  so is a fake. The `webkit*` names are absent from lib.dom, which is why
 *  every one of them is optional here. */
export interface FullscreenDocument {
  fullscreenEnabled?: boolean
  fullscreenElement?: unknown
  exitFullscreen?: () => Promise<void> | void
  webkitFullscreenEnabled?: boolean
  webkitFullscreenElement?: unknown
  webkitExitFullscreen?: () => Promise<void> | void
  addEventListener?: (type: string, cb: () => void) => void
  removeEventListener?: (type: string, cb: () => void) => void
}

/** The element the page would like made fullscreen. */
export interface FullscreenContainer {
  ownerDocument?: FullscreenDocument | null
  requestFullscreen?: () => Promise<void> | void
  webkitRequestFullscreen?: () => Promise<void> | void
}

/** A `<video>` (or an `<audio>`, which has none of these on any host). */
export interface FullscreenMedia {
  webkitEnterFullscreen?: () => void
  webkitExitFullscreen?: () => void
  webkitDisplayingFullscreen?: boolean
  addEventListener?: (type: string, cb: () => void) => void
  removeEventListener?: (type: string, cb: () => void) => void
}

export type FullscreenRoute = 'standard' | 'webkit-element' | 'ios-media' | 'none'

const docOf = (container: FullscreenContainer | null): FullscreenDocument | null =>
  container?.ownerDocument ?? null

/** Which of the three this host has for these two elements. */
export function fullscreenRoute(
  container: FullscreenContainer | null,
  media: FullscreenMedia | null
): FullscreenRoute {
  const doc = docOf(container)
  // `fullscreenEnabled` false is a document that will REJECT the request (an
  // iframe without the permission), so the method being there is not enough.
  // Absent is not false: plenty of hosts simply do not report it.
  if (container?.requestFullscreen && doc?.fullscreenEnabled !== false) return 'standard'
  if (container?.webkitRequestFullscreen && doc?.webkitFullscreenEnabled !== false)
    return 'webkit-element'
  if (media?.webkitEnterFullscreen) return 'ios-media'
  return 'none'
}

/** Whether the button is worth showing at all. */
export function canFullscreen(
  container: FullscreenContainer | null,
  media: FullscreenMedia | null
): boolean {
  return fullscreenRoute(container, media) !== 'none'
}

/** Whether something is fullscreen NOW, asked of the host rather than
 *  remembered from the tap: a phone leaves fullscreen on its own (a swipe,
 *  the back gesture, the OS player's Done) and a flag that missed it is a
 *  page with its header hidden and no way back. */
export function isFullscreen(
  container: FullscreenContainer | null,
  media: FullscreenMedia | null
): boolean {
  const doc = docOf(container)
  if (doc?.fullscreenElement || doc?.webkitFullscreenElement) return true
  return media?.webkitDisplayingFullscreen === true
}

/** A request that did not come from a gesture is rejected by every browser
 *  there is, and an unhandled rejection on a phone is a console nobody can
 *  read. Both spellings can return a promise or nothing at all. */
function swallow(r: Promise<void> | void): void {
  if (r && typeof (r as Promise<void>).catch === 'function')
    void (r as Promise<void>).catch(() => {})
}

/** Go fullscreen by whichever route this host has; the route is returned so
 *  a caller (and a test) can see which one was taken. */
export function enterFullscreen(
  container: FullscreenContainer | null,
  media: FullscreenMedia | null
): FullscreenRoute {
  const route = fullscreenRoute(container, media)
  if (route === 'standard') swallow(container?.requestFullscreen?.())
  else if (route === 'webkit-element') swallow(container?.webkitRequestFullscreen?.())
  else if (route === 'ios-media') media?.webkitEnterFullscreen?.()
  return route
}

/** Leave it again. The element asks to ENTER and the document asks to LEAVE
 *  on both element routes, which is the one asymmetry in the API; the iOS
 *  player is left on the element that entered. */
export function exitFullscreen(
  container: FullscreenContainer | null,
  media: FullscreenMedia | null
): FullscreenRoute {
  const doc = docOf(container)
  const route = fullscreenRoute(container, media)
  if (route === 'standard') swallow(doc?.exitFullscreen?.())
  else if (route === 'webkit-element') swallow(doc?.webkitExitFullscreen?.())
  else if (route === 'ios-media') media?.webkitExitFullscreen?.()
  return route
}

/**
 * Hear about every way this host changes its mind, and hand back the
 * unsubscribe. BOTH halves are subscribed whatever route was picked: the
 * document's `fullscreenchange` (and the prefixed spelling beside it), and
 * the media element's `webkitbeginfullscreen` / `webkitendfullscreen`, which
 * are the ONLY signal an iPhone gives when its native player opens or is
 * dismissed.
 */
export function onFullscreenChange(
  container: FullscreenContainer | null,
  media: FullscreenMedia | null,
  cb: () => void
): () => void {
  const doc = docOf(container)
  const bound: Array<[FullscreenDocument | FullscreenMedia, string]> = []
  const listen = (target: FullscreenDocument | FullscreenMedia | null, types: string[]): void => {
    if (!target?.addEventListener) return
    for (const t of types) {
      target.addEventListener(t, cb)
      bound.push([target, t])
    }
  }
  listen(doc, ['fullscreenchange', 'webkitfullscreenchange'])
  listen(media, ['webkitbeginfullscreen', 'webkitendfullscreen'])
  return () => {
    for (const [target, t] of bound) target.removeEventListener?.(t, cb)
  }
}
