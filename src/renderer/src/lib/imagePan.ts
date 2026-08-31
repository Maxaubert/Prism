/**
 * How far a zoomed picture may be dragged before it leaves the window.
 *
 * Panning was unbounded (2026-08-30): one firm flick at 4x put the photo
 * entirely off stage, leaving an empty window with no visible way back except
 * guessing that the zoom control resets it. The picture may be moved until its
 * edge meets the middle of the stage and no further, which is what every
 * viewer does and what makes the gesture feel like it has weight.
 *
 * Pure, so the arithmetic can be tested without a DOM.
 */

export interface Size {
  width: number
  height: number
}

export interface Stage {
  w: number
  h: number
}

/**
 * The furthest the picture may travel from centre, per axis.
 *
 * The element is `object-contain` at `h-full w-full`, so its on-screen size is
 * the source size times the shown scale. A picture smaller than the stage on
 * an axis cannot move on it at all, hence the max(0, ...).
 */
export function panBounds(img: Size, stage: Stage, shownScale: number, rot: number): { x: number; y: number } {
  const turned = ((rot % 360) + 360) % 360 % 180 === 90
  const w = (turned ? img.height : img.width) * shownScale
  const h = (turned ? img.width : img.height) * shownScale
  return {
    x: Math.max(0, (w - stage.w) / 2),
    y: Math.max(0, (h - stage.h) / 2)
  }
}

/** Keep a translation inside those bounds. */
export function clampPan(tx: number, ty: number, b: { x: number; y: number }): [number, number] {
  return [Math.max(-b.x, Math.min(b.x, tx)), Math.max(-b.y, Math.min(b.y, ty))]
}
