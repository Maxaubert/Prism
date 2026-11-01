import { thumbKeepsAlpha } from '@shared/thumbAlpha'

/** The grid tile's picture class. A thumbnail that keeps its clear parts
 *  (#477, owner 2026-11-01: "a checkerboard") draws the viewer's own faint
 *  `.p-checker` behind them once it has arrived, so the tile matches what
 *  opens; until then the tile keeps its plain ground. */
export function thumbClass(path: string, loaded: boolean): string {
  return `h-full w-full object-cover${loaded && thumbKeepsAlpha(path) ? ' p-checker' : ''}`
}
