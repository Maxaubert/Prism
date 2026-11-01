import { createContext, useContext } from 'react'
import type { VizTheme } from './core'

// What the audio and video players need to know about their look, handed in by
// the host app (#29, 2026-11-01). The players are bound for the shared
// `prism-core` that Filesmith also bundles, so they never import Prism's viz
// store or app theme: Prism installs those behind this context
// (components/PrismMediaLook), and another app installs its own. This file must
// stay free of Prism's stores, its localStorage keys and `window.prism`.

/** The visualizer and progress-bar settings a player reads. */
export interface MediaVizSettings {
  /** Visualizer style id. */
  style: string
  /** Visualizer colour scheme id. */
  theme: string
  /** Stage height and vertical position, in percent of the window. */
  height: number
  pos: number
  /** Stage width id ('full', 'wide', 'compact'). */
  width: string
  /** Show the note logo on the stage. */
  logo: boolean
  drop: number
  glow: boolean
  cycle: boolean
  move: boolean
  /** The progress bar's own scheme and effects. */
  barTheme: string
  barGlow: boolean
  barCycle: boolean
  barMove: boolean
  preview: number
}

export interface MediaLook {
  viz: MediaVizSettings
  /** A colour scheme id to its scheme (the host resolves its own accent). */
  resolveTheme: (id: string) => VizTheme
  /** A stage width id to its class names. */
  widthClass: (width: string) => string
}

export const MediaLookContext = createContext<MediaLook | null>(null)

export function useMediaLook(): MediaLook {
  const look = useContext(MediaLookContext)
  if (!look) throw new Error('A player rendered without a MediaLook provider')
  return look
}
