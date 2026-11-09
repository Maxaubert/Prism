// CTRL+WHEEL TO ZOOM STEPS (owner, 2026-11-09: "ctrl scroll to adjust the size
// of the list view"). Pure: the list feeds each Ctrl+wheel event and acts on
// the answer. Up (a negative deltaY) is bigger, as File Explorer.
//
// A mouse notch is 100px and one step. A touchpad pinch arrives as Ctrl+wheel
// with small, often fractional deltas, so a burst that STARTS small or
// fractional is a pinch and needs less travel per step (about three steps for
// a whole pinch). The pile is dropped on a pause or a reversal, and a hard
// spin gives at most one step per 60ms, the rest waiting its turn.

const MOUSE_STEP_PX = 100
const PINCH_STEP_PX = 40
const PINCH_BELOW_PX = 50
const PAUSE_MS = 250
const MIN_GAP_MS = 60
const LINE_PX = 40
const PAGE_PX = 800

export interface ZoomWheelEvent {
  deltaY: number
  deltaMode: number
}

export interface ZoomLimits {
  zoomIn: boolean
  zoomOut: boolean
}

export interface ZoomWheel {
  /** The steps to take for this event: +1 zoom in, -1 zoom out, 0 none. */
  feed: (event: ZoomWheelEvent, now: number, limits?: ZoomLimits) => number
  reset: () => void
}

export function createZoomWheel(): ZoomWheel {
  let acc = 0
  let dir = 0
  let pinch = false
  let lastAt = -Infinity
  let lastStepAt = -Infinity
  const reset = (): void => {
    acc = 0
    dir = 0
    lastAt = -Infinity
  }
  const feed = (event: ZoomWheelEvent, now: number, limits: ZoomLimits = { zoomIn: true, zoomOut: true }): number => {
    const px = event.deltaY * (event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? PAGE_PX : 1)
    if (!px) return 0
    const sign = px < 0 ? 1 : -1
    if (now - lastAt > PAUSE_MS || sign !== dir) {
      acc = 0
      dir = sign
      pinch = Math.abs(px) < PINCH_BELOW_PX || !Number.isInteger(event.deltaY)
    }
    lastAt = now
    // At an end the event is still the zoom's (the page must not scroll or
    // zoom), but nothing is kept for when the other way opens.
    if (sign > 0 ? !limits.zoomIn : !limits.zoomOut) {
      acc = 0
      return 0
    }
    acc += Math.abs(px)
    const need = pinch ? PINCH_STEP_PX : MOUSE_STEP_PX
    if (acc < need || now - lastStepAt < MIN_GAP_MS) return 0
    acc -= need
    lastStepAt = now
    return sign
  }
  return { feed, reset }
}
