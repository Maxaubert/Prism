import type { MediaLook } from './mediaLook'
import { WIDTHS, type VizState } from './vizStore'
import { resolveVizTheme } from '../theme'

// Prism's half of #29 (2026-11-01): the players' look comes from Prism's viz
// store (the Settings window edits it) and app theme. components/PrismMediaLook
// installs it, so the players themselves never import either.

const widthClass = (width: string): string => WIDTHS[width] ?? WIDTHS.full

/** Prism's look for the given viz settings. */
export const prismMediaLook = (viz: VizState): MediaLook => ({
  viz,
  resolveTheme: resolveVizTheme,
  widthClass
})
