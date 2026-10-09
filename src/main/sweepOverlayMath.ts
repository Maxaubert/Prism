import type { CssPoint, CssRect, UpdateCause } from '@shared/sweepOverlay'

/**
 * The native sweep box in the window's PHYSICAL client pixels (#338), which is
 * what the addon's thread reads the cursor in (`GetCursorPos` +
 * `ScreenToClient`). The page speaks CSS px; `dpr` already folds Chromium's
 * zoom and the window's DPI. The anchor rounds; the clip grows outward
 * (`floor` left and top, `ceil` right and bottom), so the box never stops a
 * pixel short of where the DOM box would reach.
 */
export interface PhysBox {
  ax: number
  ay: number
  left: number
  top: number
  right: number
  bottom: number
  /** The edge's width in physical px. */
  edge: number
  cause?: UpdateCause
}

/**
 * Where the client's (0, 0) is in the DComp target's coordinates. MEASURED in
 * the spike (2026-10-10, research prism/2026-10-09-native-sweep-spike.md): the
 * native box's anchored edge sat exactly on the DOM box's at rest, 0 px, in a
 * normal window (62 and 49 rest samples) and maximised (1), so with
 * `titleBarStyle: 'hidden'` the client and the target share their origin.
 */
export const SWEEP_ORIGIN: Readonly<CssPoint> = { x: 0, y: 0 }

/** What Chromium draws for a 1 CSS px border: whole device pixels, never 0. */
export function edgeWidth(dpr: number): number {
  return Math.max(1, Math.round(dpr))
}

export function toPhysical(
  m: { anchor: CssPoint; clip: CssRect; dpr: number; cause?: UpdateCause },
  origin: { x: number; y: number }
): PhysBox {
  const d = m.dpr
  const box: PhysBox = {
    ax: Math.round(m.anchor.x * d) + origin.x,
    ay: Math.round(m.anchor.y * d) + origin.y,
    left: Math.floor(m.clip.left * d) + origin.x,
    top: Math.floor(m.clip.top * d) + origin.y,
    right: Math.ceil(m.clip.right * d) + origin.x,
    bottom: Math.ceil(m.clip.bottom * d) + origin.y,
    edge: edgeWidth(d)
  }
  if (m.cause) box.cause = m.cause
  return box
}
