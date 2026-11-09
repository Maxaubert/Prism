/**
 * THE FOLDER'S BLANK-SPACE MENU (zoom grid Stage 6, 2026-11-10; spec 5.5): what
 * a right-click on the empty space of a plain folder shows. One row, the other
 * way round from the look you are in: "Show as grid" from a list (the first
 * tile step), "Show as list" from a grid (Medium, the list's default). Opened
 * by App (`zoomMenu`).
 */
import type { MenuItem } from '../components/ContextMenu'
import { GRID_STEP, atStep } from '../lib/explorerZoom'

export interface ZoomBlankMenuContext {
  /** The zoom step now. */
  step: number
  setStep: (step: number) => void
}

/** Medium: the step the list comes back to. */
const LIST_STEP = 1

export function zoomBlankMenu(ctx: ZoomBlankMenuContext): MenuItem[] {
  return atStep(ctx.step).kind === 'tile'
    ? [{ label: 'Show as list', onPick: () => ctx.setStep(LIST_STEP) }]
    : [{ label: 'Show as grid', onPick: () => ctx.setStep(GRID_STEP) }]
}
