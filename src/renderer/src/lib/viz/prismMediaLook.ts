import type { MediaLook, MediaVizSettings } from './mediaLook'
import { WIDTHS, type VizState } from './vizStore'
import { resolveVizTheme } from '../theme'

// Prism's half of #29 (2026-11-01): the players' look comes from Prism's viz
// store (the Settings window edits it) and app theme. components/PrismMediaLook
// installs it, so the players themselves never import either.

const widthClass = (width: string): string => WIDTHS[width] ?? WIDTHS.full

/**
 * The store's settings narrowed to what a player reads. Spelled out field by
 * field, so a field added to MediaVizSettings fails to compile here until Prism
 * supplies it, and the store's own state (presets, removed themes) never
 * reaches the players.
 */
const playerSettings = (s: VizState): MediaVizSettings => ({
  style: s.style,
  theme: s.theme,
  height: s.height,
  pos: s.pos,
  width: s.width,
  logo: s.logo,
  drop: s.drop,
  glow: s.glow,
  cycle: s.cycle,
  move: s.move,
  barTheme: s.barTheme,
  barGlow: s.barGlow,
  barCycle: s.barCycle,
  barMove: s.barMove,
  preview: s.preview
})

/** Prism's look for the given viz settings. */
export const prismMediaLook = (viz: VizState): MediaLook => ({
  viz: playerSettings(viz),
  resolveTheme: resolveVizTheme,
  widthClass
})
