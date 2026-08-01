import { useSyncExternalStore } from 'react'
import { THEMES } from './viz/styles'
import { setBarTheme, setTheme } from './vizStore'

// The app's look, as one named style. A style owns the material, the six colour
// roles, the font and the shape of the frame - and nothing else: hover, the
// progress bar, the visualizer and the accent effects are the user's, so
// switching styles never moves them.
//
// Everything is published as CSS custom properties on :root, so components read
// `var(--p-side)` rather than knowing which style is on.

export type Mode = 'dark' | 'light'
export type Material = 'solid' | 'gradient' | 'tinted' | 'oled' | 'acrylic' | 'mica'
export type IconMode = 'kind' | 'text' | 'dim' | 'accent' | 'custom'

export interface Style {
  id: string
  name: string
  blurb: string
  mode: Mode
  material: Material
  /** Surfaces: the viewer canvas, the tree panel, the title bar. */
  bg: string
  side: string
  title: string
  text: string
  iconMode: IconMode
  icon: string
  /** Id of a scheme in viz THEMES. Drives selection, the bar and the visualizer. */
  accent: string
  font: FontId
  size: '12' | '12.5' | '13.5'
  corners: '2' | '8' | '14'
  borders: 'hairline' | 'none' | 'strong'
}

export type FontId = 'system' | 'segoe' | 'bahnschrift' | 'calibri' | 'trebuchet' | 'verdana' | 'georgia' | 'mono'

export const FONTS: Record<FontId, { name: string; stack: string }> = {
  system: { name: 'System', stack: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif' },
  segoe: { name: 'Segoe UI', stack: '"Segoe UI", system-ui, sans-serif' },
  bahnschrift: { name: 'Bahnschrift', stack: 'Bahnschrift, "DIN Alternate", system-ui, sans-serif' },
  calibri: { name: 'Calibri', stack: 'Calibri, Candara, system-ui, sans-serif' },
  trebuchet: { name: 'Trebuchet', stack: '"Trebuchet MS", system-ui, sans-serif' },
  verdana: { name: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
  georgia: { name: 'Georgia', stack: 'Georgia, "Times New Roman", serif' },
  mono: { name: 'Mono', stack: '"Cascadia Mono", Consolas, ui-monospace, monospace' }
}

export const STYLES: Style[] = [
  {
    id: 'default',
    name: 'Default',
    blurb: 'Acrylic over true black, sky accent.',
    mode: 'dark',
    material: 'acrylic',
    bg: '#000000',
    side: '#141414',
    title: '#141414',
    text: '#eef0f4',
    iconMode: 'kind',
    icon: '#8a8e99',
    accent: 's-sky',
    font: 'system',
    size: '12.5',
    corners: '2',
    borders: 'hairline'
  },
  {
    id: 'acrylic-red',
    name: 'Acryllic Red',
    blurb: 'Acrylic, round, crimson.',
    mode: 'dark',
    material: 'acrylic',
    bg: '#101420',
    side: '#141821',
    title: '#1a1f2b',
    text: '#eceef5',
    iconMode: 'accent',
    icon: '#8b5cf6',
    accent: 's-crimson',
    font: 'system',
    size: '12.5',
    corners: '14',
    borders: 'none'
  },
  {
    id: 'new-ember',
    name: 'New ember',
    blurb: 'Warm tint, coral accent.',
    mode: 'dark',
    material: 'tinted',
    bg: '#191720',
    side: '#1c1a22',
    title: '#231f28',
    text: '#f0e7dc',
    iconMode: 'custom',
    icon: '#d3a06a',
    accent: 's-coral',
    font: 'calibri',
    size: '12.5',
    corners: '8',
    borders: 'hairline'
  },
  {
    id: 'new-void',
    name: 'New void',
    blurb: 'True black, no edges.',
    mode: 'dark',
    material: 'oled',
    bg: '#000000',
    side: '#000000',
    title: '#000000',
    text: '#e8eaf0',
    iconMode: 'dim',
    icon: '#8a8e99',
    accent: 's-indigo',
    font: 'segoe',
    size: '12.5',
    corners: '2',
    borders: 'none'
  },
  {
    id: 'terminal',
    name: 'Terminal update',
    blurb: 'Mono, green, square.',
    mode: 'dark',
    material: 'solid',
    bg: '#0b0f14',
    side: '#0d1117',
    title: '#11161d',
    text: '#d7e0d9',
    iconMode: 'accent',
    icon: '#3f9d54',
    accent: 's-green',
    font: 'mono',
    size: '12.5',
    corners: '2',
    borders: 'none'
  },
  {
    id: 'graphite',
    name: 'Graphite',
    blurb: 'Neutral and square. The default.',
    mode: 'dark',
    material: 'solid',
    bg: '#101215',
    side: '#141719',
    title: '#1a1d21',
    text: '#e3e6ea',
    iconMode: 'dim',
    icon: '#868d96',
    accent: 'd-steel',
    font: 'segoe',
    size: '12.5',
    corners: '2',
    borders: 'hairline'
  },
  {
    id: 'driftwood',
    name: 'Driftwood',
    blurb: 'Warm, tinted, roomy.',
    mode: 'dark',
    material: 'tinted',
    bg: '#16130f',
    side: '#1a1713',
    title: '#221d17',
    text: '#ece2d2',
    iconMode: 'custom',
    icon: '#a1885f',
    accent: 'copper',
    font: 'calibri',
    size: '12.5',
    corners: '8',
    borders: 'hairline'
  },
  {
    id: 'prism',
    name: 'Prism',
    blurb: 'The original look, in blue.',
    mode: 'dark',
    material: 'solid',
    bg: '#0d0f14',
    side: '#0e1016',
    title: '#16181f',
    text: '#eef0f4',
    iconMode: 'kind',
    icon: '#8a8e99',
    accent: 'prism',
    font: 'system',
    size: '12.5',
    corners: '8',
    borders: 'hairline'
  }
]

const LIGHT: Style[] = [
  {
    id: 'paper',
    name: 'Paper',
    blurb: 'Plain white, Prism blue.',
    mode: 'light',
    material: 'solid',
    bg: '#f7f7f8',
    side: '#efeff1',
    title: '#e7e8ea',
    text: '#1b1d21',
    iconMode: 'kind',
    icon: '#6b7280',
    accent: 'prism',
    font: 'system',
    size: '12.5',
    corners: '8',
    borders: 'hairline'
  },
  {
    id: 'ash',
    name: 'Ash',
    blurb: 'Neutral grey, square.',
    mode: 'light',
    material: 'solid',
    bg: '#eceef0',
    side: '#e4e6e9',
    title: '#dbdee2',
    text: '#1c1f24',
    iconMode: 'dim',
    icon: '#6b7280',
    accent: 'd-slate',
    font: 'segoe',
    size: '12.5',
    corners: '2',
    borders: 'hairline'
  },
  {
    id: 'linen',
    name: 'Linen',
    blurb: 'Warm paper, bronze.',
    mode: 'light',
    material: 'solid',
    bg: '#f8f4ed',
    side: '#f1ebe1',
    title: '#e9e2d5',
    text: '#241f18',
    iconMode: 'custom',
    icon: '#8a6d45',
    accent: 'd-bronze',
    font: 'calibri',
    size: '12.5',
    corners: '8',
    borders: 'hairline'
  },
  {
    id: 'frost',
    name: 'Frost',
    blurb: 'Cool white, deep teal.',
    mode: 'light',
    material: 'solid',
    bg: '#f4f8fb',
    side: '#e9f0f6',
    title: '#dfe8f1',
    text: '#152029',
    iconMode: 'custom',
    icon: '#4a7d92',
    accent: 'd-teal',
    font: 'system',
    size: '12.5',
    corners: '14',
    borders: 'none'
  },
  {
    id: 'meadow',
    name: 'Meadow',
    blurb: 'Soft green, pine accent.',
    mode: 'light',
    material: 'solid',
    bg: '#f5f8f3',
    side: '#ecf2e9',
    title: '#e2ebde',
    text: '#1a201a',
    iconMode: 'custom',
    icon: '#5c7a56',
    accent: 'd-pine',
    font: 'trebuchet',
    size: '12.5',
    corners: '8',
    borders: 'hairline'
  },
  {
    id: 'daylight',
    name: 'Daylight',
    blurb: 'Acrylic over white.',
    mode: 'light',
    material: 'acrylic',
    bg: '#ffffff',
    side: '#f4f4f6',
    title: '#ededf0',
    text: '#17191d',
    iconMode: 'kind',
    icon: '#6b7280',
    accent: 's-sky',
    font: 'system',
    size: '12.5',
    corners: '2',
    borders: 'hairline'
  }
]

STYLES.push(...LIGHT)

export const DEFAULT_STYLE = 'graphite'

/* ---------- colour maths ---------- */

const hex2rgb = (h: string): number[] => {
  const s = h.replace('#', '')
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const rgb2hex = (c: number[]): string =>
  '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
export const mix = (a: string, b: string, t: number): string => {
  const A = hex2rgb(a)
  const B = hex2rgb(b)
  return rgb2hex(A.map((v, i) => v + (B[i] - v) * t))
}
const lighten = (c: string, t: number): string => mix(c, '#ffffff', t)
export const rgba = (c: string, a: number): string => {
  const [r, g, b] = hex2rgb(c)
  return `rgba(${r},${g},${b},${a})`
}

function luminance(hex: string): number {
  const [r, g, b] = hex2rgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contrast(a: string, b: string): number {
  const l1 = luminance(a)
  const l2 = luminance(b)
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Ink or paper on `bg`. White is the default and only loses when black is
 * clearly better: on mid-tones the two land within a few percent of each other,
 * and flipping to black there reads as a mistake even when the numbers
 * marginally favour it.
 */
export const readableOn = (bg: string): string =>
  contrast(bg, '#0b0d12') >= contrast(bg, '#ffffff') * 1.4 ? '#0b0d12' : '#ffffff'

/**
 * Dim `text` towards `surface` as far as it can go while still clearing
 * `target` contrast. Mixing by a fixed fraction is what produced grey-on-white:
 * on a dark style it dims, on a light one it washes the text out.
 */
export function dimmed(text: string, surface: string, target: number): string {
  let out = text
  for (let t = 0.05; t <= 0.75; t += 0.05) {
    const c = mix(text, surface, t)
    if (contrast(c, surface) < target) break
    out = c
  }
  return out
}

/**
 * The accent, nudged until its label clears AA. A selected row is the one place
 * text sits ON the accent, and some perfectly good accents land just short:
 * indigo gives white 4.47:1. Deepen (or lighten) it a touch rather than ban the
 * colour or ship text that fails.
 */
export function selectionBg(accent: string): string {
  const ink = readableOn(accent)
  const towards = ink === '#ffffff' ? '#000000' : '#ffffff'
  if (contrast(ink, accent) >= 4.5) return accent
  for (let t = 0.04; t <= 0.6; t += 0.04) {
    const bg = mix(accent, towards, t)
    if (contrast(ink, bg) >= 4.5) return bg
  }
  return mix(accent, towards, 0.6)
}

/** The per-kind tints, dark enough to read on a light surface. */
export const KIND_TINTS: Record<string, string> = {
  image: '#6fb2a8',
  video: '#8f8ae0',
  audio: '#d3a06a',
  pdf: '#cf7f88',
  text: '#8d93a1',
  folder: '#9aa0f0'
}

/** Everything a style resolves to. Exported so the styles can be checked. */
export function derive(style: Style): Record<string, string> {
  const palette = accentOf(style.accent)
  const accent = palette[0]
  const side = style.material === 'tinted' ? mix(style.side, accent, 0.1) : style.side
  const bg = style.material === 'tinted' ? mix(style.bg, accent, 0.07) : style.bg
  const light = style.mode === 'light'
  const kinds: Record<string, string> = {}
  for (const [k, v] of Object.entries(KIND_TINTS)) {
    // The tints were picked for a dark panel; on paper they need taking down.
    kinds['--p-kind-' + k] = light ? mix(v, '#000000', 0.42) : v
  }
  return {
    '--p-bg': bg,
    '--p-side-flat': side,
    '--p-text': style.text,
    '--p-text-soft': dimmed(style.text, side, 7),
    '--p-dim': dimmed(style.text, side, 4.5),
    '--p-dim2': dimmed(style.text, side, 3.2),
    '--p-accent': accent,
    '--p-accent-hi': light ? mix(accent, '#000000', 0.15) : lighten(accent, 0.25),
    '--p-sel-bg': selectionBg(accent),
    '--p-on-accent': readableOn(selectionBg(accent)),
    ...kinds
  }
}

/* ---------- applying a style ---------- */

const accentOf = (id: string): string[] => THEMES.find((t) => t.id === id)?.palette ?? ['#5b5bd6']

function paint(style: Style): void {
  const r = document.documentElement.style
  const palette = accentOf(style.accent)
  const accent = palette[0]

  let bg = style.bg
  let side = style.side
  let title = style.title
  const translucent = style.material === 'acrylic' || style.material === 'mica'
  if (translucent) {
    // Windows composites the material behind the window; these surfaces sit on
    // top of it, so they have to let it through.
    const a = style.material === 'acrylic' ? 0.55 : 0.82
    bg = rgba(style.bg, a * 0.75)
    side = rgba(style.side, a)
    title = rgba(style.title, a + 0.08)
  } else if (style.material === 'gradient') {
    side = `linear-gradient(180deg, ${lighten(style.side, 0.06)}, ${style.side})`
    title = `linear-gradient(180deg, ${lighten(style.title, 0.07)}, ${style.title})`
  } else if (style.material === 'tinted') {
    bg = mix(style.bg, accent, 0.07)
    side = mix(style.side, accent, 0.1)
    title = mix(style.title, accent, 0.12)
  }

  const ink = style.mode === 'light' ? '#000000' : '#ffffff'
  const divider =
    style.borders === 'none'
      ? 'transparent'
      : style.borders === 'strong'
        ? rgba(ink, style.mode === 'light' ? 0.18 : 0.16)
        : rgba(ink, style.mode === 'light' ? 0.1 : 0.07)

  const icon =
    style.iconMode === 'text'
      ? style.text
      : style.iconMode === 'accent'
        ? accent
        : style.iconMode === 'custom'
          ? style.icon
          : dimmed(style.text, style.side, 4.5)

  const set = (k: string, v: string): void => r.setProperty(k, v)
  set('--p-bg', bg)
  set('--p-side', side)
  set('--p-side-flat', style.material === 'tinted' ? mix(style.side, accent, 0.1) : style.side)
  set('--p-title', title)
  for (const [k, v] of Object.entries(derive(style))) {
    if (k !== '--p-bg' && k !== '--p-side-flat') set(k, v)
  }
  set('--p-icon', icon)
  set('--p-hover', rgba(ink, style.mode === 'light' ? 0.07 : 0.06))
  set('--p-divider', divider)
  set('--p-radius', style.corners + 'px')
  set('--p-radius-sm', Math.max(2, Number(style.corners) - 2) + 'px')
  set('--p-font', FONTS[style.font].stack)
  set('--p-size', style.size + 'px')
  set('--p-row', (style.size === '13.5' ? 31 : style.size === '12' ? 22 : 26) + 'px')
  set('--p-indent', (style.size === '13.5' ? 15 : style.size === '12' ? 11 : 13) + 'px')
  document.documentElement.dataset.icons = style.iconMode
  document.documentElement.dataset.mode = style.mode
  // A translucent style needs the window itself to be transparent, which only
  // the main process can arrange.
  if (typeof window !== 'undefined') {
    window.prism?.setWindowMaterial(translucent ? style.material : 'none')
  }
}

/* ---------- the store ---------- */

const KEY = 'prism.style'
const MODE_KEY = 'prism.mode'

const byId = (id: string): Style => STYLES.find((s) => s.id === id) ?? STYLES[0]

function load(): string {
  try {
    const v = localStorage.getItem(KEY)
    return STYLES.some((s) => s.id === v) ? (v as string) : DEFAULT_STYLE
  } catch {
    return DEFAULT_STYLE
  }
}
function loadMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

let current = load()
let mode: Mode = loadMode()
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach((l) => l())

/** Switch style. The accent also becomes the progress bar's and the
 *  visualizer's colour, so the app doesn't disagree with itself. */
export function setStyle(id: string): void {
  const style = byId(id)
  current = style.id
  localStorage.setItem(KEY, style.id)
  paint(style)
  setTheme(style.accent)
  setBarTheme(style.accent)
  emit()
}

/** Dark or light. Light styles land in a later pass; until then this records
 *  the preference and the dark set stays on screen. */
export function setMode(m: Mode): void {
  mode = m
  localStorage.setItem(MODE_KEY, m)
  const first = STYLES.find((s) => s.mode === m)
  if (first) setStyle(first.id)
  else emit()
}

export function useStyle(): Style {
  const id = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current
  )
  return byId(id)
}

export function useMode(): Mode {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => mode
  )
}

export const stylesFor = (m: Mode): Style[] => STYLES.filter((s) => s.mode === m)

// Paint before first render so nothing flashes the wrong colour.
paint(byId(current))

// On a fresh install the visualizer and the progress bar have no colour of their
// own yet, so they take the style's accent. Once you've picked one, it stands.
try {
  if (!localStorage.getItem('prism.viz.theme')) setTheme(byId(current).accent)
  if (!localStorage.getItem('prism.viz.barTheme')) setBarTheme(byId(current).accent)
} catch {
  /* no storage: the defaults in vizStore stand */
}
