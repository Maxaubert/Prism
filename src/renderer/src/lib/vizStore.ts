import { useSyncExternalStore } from 'react'
import {
  ACCENT_THEME_ID,
  THEMES,
  DEFAULT_STYLE_ID,
  DEFAULT_THEME_ID,
  DEFAULT_DROP_STYLE
} from './viz/styles'

// A tiny reactive store for the visualizer + transport-colour settings, so the
// in-canvas gear panel (AudioView) and the app Settings window are two views over
// ONE source of truth. Everything persists to localStorage under the same keys the
// app has always used, so existing saved looks carry over. `preview` is transient
// (a counter the drop-effect picker bumps to fire a one-off preview).

export interface Preset {
  id: string
  name: string
  style: string
  height: number
  pos: number
  width: string
  logo: boolean
  /** Colour theme; older presets without it fall back to the default. */
  theme?: string
}

const K = {
  style: 'prism.viz.style',
  theme: 'prism.viz.theme',
  width: 'prism.viz.width',
  logo: 'prism.viz.logo',
  height: 'prism.viz.height',
  pos: 'prism.viz.pos',
  drop: 'prism.viz.drop',
  glow: 'prism.viz.glow',
  cycle: 'prism.viz.cycle',
  move: 'prism.viz.move',
  barTheme: 'prism.viz.barTheme',
  barGlow: 'prism.viz.barGlow',
  barCycle: 'prism.viz.barCycle',
  barMove: 'prism.viz.barMove',
  presets: 'prism.viz.presets',
  presetsSeed: 'prism.viz.presetsSeed',
  removed: 'prism.viz.removedThemes'
} as const

// Bump when DEFAULT_PRESETS changes and the new set should replace what users
// (and this dev box) already have stored. End users only ever seed once.
const PRESETS_SEED = 10

// With the visualizer filling the whole viewer, pos 50 is genuinely the nav-line
// centre, so mirrored/centred styles all sit at 50. The two grounded styles sit
// low on purpose (bars rise from the transport). Halo is trimmed a little so the
// ring clears the transport overlay at the bottom.
// Order groups related shapes side by side: the outline/solid pair of square bars,
// then the outline/solid pair of capsule (Round) bars, then the mirrored family,
// then needles, then the two grids.
const DEFAULT_PRESETS: Preset[] = [
  { id: 'halo', name: 'Halo', style: 'ripples', height: 88, pos: 50, width: 'full', logo: false, theme: 'brand' },
  { id: 'flow', name: 'Flow', style: 'liquid', height: 95, pos: 50, width: 'full', logo: false },
  { id: 'outline', name: 'Outline', style: 'outline-bars', height: 53, pos: 73, width: 'full', logo: false },
  { id: 'bars', name: 'Bars', style: 'solid-bars', height: 53, pos: 73, width: 'full', logo: false },
  { id: 'barscircle', name: 'Round', style: 'outline-round', height: 56, pos: 72, width: 'full', logo: false },
  { id: 'barscirclefull', name: 'Round Solid', style: 'solid-round', height: 56, pos: 72, width: 'full', logo: false },
  { id: 'frame', name: 'Frame', style: 'mirror-outline', height: 44, pos: 50, width: 'full', logo: false },
  { id: 'mirrorbars', name: 'Mirror Bars', style: 'chrome-bars', height: 51, pos: 50, width: 'full', logo: false },
  { id: 'caps', name: 'Caps', style: 'mirror-caps', height: 41, pos: 50, width: 'full', logo: false },
  { id: 'linebars', name: 'Line Bars', style: 'needles', height: 44, pos: 50, width: 'full', logo: false },
  { id: 'wall', name: 'Wall', style: 'clean-wall', height: 56, pos: 72, width: 'full', logo: false },
  { id: 'wall2', name: 'Wall 2', style: 'segments', height: 56, pos: 72, width: 'full', logo: false }
]

// Width presets for the stage; some styles read better spanning the glass, others
// want to sit in a band.
export const WIDTHS: Record<string, string> = {
  full: 'w-full',
  wide: 'w-full max-w-5xl',
  compact: 'w-full max-w-2xl'
}
export const WIDTH_LABELS: Array<[string, string]> = [
  ['full', 'Full'],
  ['wide', 'Wide'],
  ['compact', 'Compact']
]

// The progress bar picks from the SAME colour schemes as the visualizer, with its
// own selection and its own effect toggles (independent of the visualizer's).
export const DEFAULT_BAR_THEME = DEFAULT_THEME_ID

export interface VizState {
  style: string
  theme: string
  height: number
  pos: number
  width: string
  logo: boolean
  drop: number
  /** Colour effects for the visualizer, applied on top of its scheme (all combine). */
  glow: boolean
  cycle: boolean
  move: boolean
  /** The progress bar's own scheme + effects, independent of the visualizer. */
  barTheme: string
  barGlow: boolean
  barCycle: boolean
  barMove: boolean
  preview: number
  presets: Preset[]
  removed: string[]
}

function num(key: string, fallback: number): number {
  const v = Number(localStorage.getItem(key))
  return Number.isFinite(v) && v > 0 ? v : fallback
}

function loadPresets(): Preset[] {
  // A newer seed replaces whatever is stored, so an updated shipped set actually
  // reaches people who already have an older one saved.
  if (Number(localStorage.getItem(K.presetsSeed)) !== PRESETS_SEED) {
    localStorage.setItem(K.presets, JSON.stringify(DEFAULT_PRESETS))
    localStorage.setItem(K.presetsSeed, String(PRESETS_SEED))
    return DEFAULT_PRESETS
  }
  try {
    const raw = localStorage.getItem(K.presets)
    if (!raw) return DEFAULT_PRESETS
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.every((p) => p && p.id && p.name && p.style)) return parsed
  } catch {
    /* corrupt or hand-edited; fall back to the shipped set */
  }
  return DEFAULT_PRESETS
}

function loadRemoved(): string[] {
  try {
    const raw = localStorage.getItem(K.removed)
    if (raw) {
      // Keep only ids that still exist; once a removal has been baked into the
      // code the theme is gone, so drop it rather than showing a stale count.
      const live = new Set(THEMES.map((t) => t.id))
      const kept = (JSON.parse(raw) as string[]).filter((id) => live.has(id))
      localStorage.setItem(K.removed, JSON.stringify(kept))
      return kept
    }
  } catch {
    /* ignore */
  }
  return []
}

let state: VizState = {
  style: localStorage.getItem(K.style) || DEFAULT_STYLE_ID,
  theme: localStorage.getItem(K.theme) || DEFAULT_THEME_ID,
  height: num(K.height, 88),
  pos: num(K.pos, 50),
  width: localStorage.getItem(K.width) || 'full',
  logo: localStorage.getItem(K.logo) === '1',
  drop: num(K.drop, DEFAULT_DROP_STYLE),
  glow: localStorage.getItem(K.glow) === '1',
  cycle: localStorage.getItem(K.cycle) === '1',
  move: localStorage.getItem(K.move) === '1',
  barTheme: localStorage.getItem(K.barTheme) || DEFAULT_BAR_THEME,
  barGlow: localStorage.getItem(K.barGlow) === '1',
  barCycle: localStorage.getItem(K.barCycle) === '1',
  barMove: localStorage.getItem(K.barMove) === '1',
  preview: 0,
  presets: loadPresets(),
  removed: loadRemoved()
}

const listeners = new Set<() => void>()
function apply(p: Partial<VizState>): void {
  state = { ...state, ...p }
  listeners.forEach((l) => l())
}

/** Themes still visible in the picker (not curated out). */
/** The schemes a picker offers. The accent-following one is left out: it is not
 *  a colour of its own, and offering it as an *accent* would be circular. The
 *  visualizer's own picker puts it back, resolved. */
export function visibleThemes(): typeof THEMES {
  return THEMES.filter((t) => !state.removed.includes(t.id) && t.id !== ACCENT_THEME_ID)
}

export const setStyle = (id: string): void => {
  localStorage.setItem(K.style, id)
  apply({ style: id })
}
export const setTheme = (id: string): void => {
  localStorage.setItem(K.theme, id)
  apply({ theme: id })
}
export const setHeight = (n: number): void => {
  localStorage.setItem(K.height, String(n))
  apply({ height: n })
}
export const setPos = (n: number): void => {
  localStorage.setItem(K.pos, String(n))
  apply({ pos: n })
}
export const setWidth = (w: string): void => {
  localStorage.setItem(K.width, w)
  apply({ width: w })
}
export const setLogo = (b: boolean): void => {
  localStorage.setItem(K.logo, b ? '1' : '0')
  apply({ logo: b })
}
export const setDrop = (n: number): void => {
  localStorage.setItem(K.drop, String(n))
  apply({ drop: n })
}
export const setGlow = (b: boolean): void => {
  localStorage.setItem(K.glow, b ? '1' : '0')
  apply({ glow: b })
}
export const setCycle = (b: boolean): void => {
  localStorage.setItem(K.cycle, b ? '1' : '0')
  apply({ cycle: b })
}
export const setMove = (b: boolean): void => {
  localStorage.setItem(K.move, b ? '1' : '0')
  apply({ move: b })
}
export const setBarTheme = (id: string): void => {
  localStorage.setItem(K.barTheme, id)
  apply({ barTheme: id })
}
export const setBarGlow = (b: boolean): void => {
  localStorage.setItem(K.barGlow, b ? '1' : '0')
  apply({ barGlow: b })
}
export const setBarCycle = (b: boolean): void => {
  localStorage.setItem(K.barCycle, b ? '1' : '0')
  apply({ barCycle: b })
}
export const setBarMove = (b: boolean): void => {
  localStorage.setItem(K.barMove, b ? '1' : '0')
  apply({ barMove: b })
}
/** Bump the preview counter so a drop effect plays once, right now. */
export const firePreview = (): void => apply({ preview: state.preview + 1 })

export function applyPreset(p: Preset): void {
  localStorage.setItem(K.style, p.style)
  localStorage.setItem(K.theme, p.theme ?? DEFAULT_THEME_ID)
  localStorage.setItem(K.height, String(p.height))
  localStorage.setItem(K.pos, String(p.pos))
  localStorage.setItem(K.width, p.width)
  localStorage.setItem(K.logo, p.logo ? '1' : '0')
  apply({
    style: p.style,
    theme: p.theme ?? DEFAULT_THEME_ID,
    height: p.height,
    pos: p.pos,
    width: p.width,
    logo: p.logo
  })
}

function savePresets(list: Preset[]): void {
  localStorage.setItem(K.presets, JSON.stringify(list))
  apply({ presets: list })
}

/** Save the current settings under `name`; an existing name is overwritten in
 *  place, keeping its position in the row. */
export function savePreset(name: string): void {
  const trimmed = name.trim()
  if (!trimmed) return
  const entry: Preset = {
    id: trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: trimmed,
    style: state.style,
    height: state.height,
    pos: state.pos,
    width: state.width,
    logo: state.logo,
    theme: state.theme
  }
  const i = state.presets.findIndex((p) => p.name.toLowerCase() === trimmed.toLowerCase())
  if (i >= 0) {
    const next = state.presets.slice()
    next[i] = { ...entry, id: state.presets[i].id }
    savePresets(next)
  } else {
    savePresets([...state.presets, entry])
  }
}

export const deletePreset = (id: string): void => savePresets(state.presets.filter((p) => p.id !== id))
export function resetPresets(): void {
  localStorage.removeItem(K.presets)
  localStorage.removeItem(K.presetsSeed)
  apply({ presets: loadPresets() })
}

export function removeTheme(id: string): void {
  const next = state.removed.includes(id) ? state.removed : [...state.removed, id]
  localStorage.setItem(K.removed, JSON.stringify(next))
  apply({ removed: next })
  // If we just hid the active theme, jump to the next surviving one.
  if (id === state.theme) {
    const survivor = THEMES.find((t) => t.id !== id && !next.includes(t.id))
    if (survivor) setTheme(survivor.id)
  }
}
export function restoreThemes(): void {
  localStorage.removeItem(K.removed)
  apply({ removed: [] })
}

/** The current settings, for callers that are not components. */
export const vizState = (): VizState => state

export function useViz(): VizState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state
  )
}
