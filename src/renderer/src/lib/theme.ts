import { useSyncExternalStore } from 'react'
import { ACCENT_THEME_ID, THEMES, themeById } from './viz/styles'
import type { VizTheme } from './viz/core'
import { setBarTheme, setTheme, vizState } from './vizStore'
import { resetTermExtras, setTermThemeId } from 'prism-term-core/renderer/lib/termLook'
import {
  alphaOf,
  composite,
  legibleOn,
  opaque,
  parseColour,
  selectionFor as selectionOver,
  toStored,
  withAlpha
} from 'prism-term-core/renderer/lib/colour'
import { accentAlphaOf, fillOf } from './accentAlpha'
import { hintOn, nearBlackField } from './fieldColours'

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

/**
 * Which SET the file icons are drawn from (2026-09-01), replacing the colour
 * picker that used to sit here.
 *
 * 'mono' is `fileIconOf`: one ink for every kind, white or a near-black chosen
 * by the better of two measured ratios against the style's own ground, so the
 * KIND lives in the shape. 'colour' is the preset per-kind scheme baked into
 * `iconPaths.ts` (ICON_COLOURS), which is a set of picks rather than anything
 * derived from the style - it looks the same on every ground on purpose,
 * because that is what makes it the same icon Explorer shows.
 */
export type IconScheme = 'mono' | 'colour'

export interface Style {
  id: string
  name: string
  blurb: string
  mode: Mode
  material: Material
  /** Surfaces: the viewer canvas, the tree panel, the title bar. */
  bg: string
  side: string
  /** The sidebar wears its OWN colour (owner, 2026-09-03). Unset, `side` is a
   *  legacy value the schematics draw and the window ignores - the one-surface
   *  rule below derives the panel from bg. Set, the user chose the panel's
   *  colour and variablesFor honours it. */
  sideOwn?: boolean
  /** The title bar wears its OWN colour (owner, 2026-09-03), same rule as
   *  `sideOwn`: unset, `title` is schematic-only and the bar derives from bg. */
  titleOwn?: boolean
  /** The tab bar's own colour, when chosen; unset it follows the title bar.
   *  The ACTIVE tab is always a step off whatever the tab bar is - never the
   *  sidebar's colour, which it used to borrow (owner, same day). */
  tabs?: string
  tabsOwn?: boolean
  title: string
  text: string
  iconMode: IconMode
  icon: string
  /** The folder rows' colour, when chosen. */
  folderIcon?: string
  /** Which SET the file icons are drawn from. Unset means monochrome, which is
   *  the ink measured against this style's own ground. */
  iconScheme?: IconScheme
  /** Id of a scheme in viz THEMES. Drives selection, the bar and the visualizer. */
  accent: string
  /** How solid the accent's FILLS are, 0.1 to 1 (#249). Unset is 1, which is
   *  every style saved before it existed. Read it through accentAlphaOf. */
  accentAlpha?: number
  /** The marked-file tint's own colour and strength (#257), six or eight hex
   *  digits. Unset, it follows the accent at TINT_ALPHA. */
  selection?: string
  font: FontId
  size: '12' | '12.5' | '13.5'
  corners: '2' | '8' | '14'
  borders: 'hairline' | 'none' | 'strong' | 'faint'
  /** Surface alpha for acrylic and mica. Lower lets more of the frost through;
   *  omitted, a style takes the default for its mode. */
  glass?: number
  /** Whether the window carries a soft light behind it. The colours come from
   *  the accent, so changing the accent changes the glow with it. */
  wash?: boolean
  /** Saved by the user rather than shipped: it can be deleted. */
  custom?: boolean
  /** For a saved preset, the shipped style it grew out of. */
  base?: string
}

/**
 * EVERY SHIPPED STYLE SETS IN THE SYSTEM FACE (owner, 2026-09-20: "update all
 * themes to use the system font by default"). Four of them named one of their
 * own - Void in Segoe, Terminal in Cascadia Mono, Driftwood and Sandstone in
 * Calibri, Lilac in Trebuchet - so picking a style silently changed the face
 * the whole app set in, which is a second decision hidden inside the first.
 * The FONTS table and the picker are untouched: choosing a face is still the
 * user's, it is simply no longer made for them. A new preset ships with
 * `font: 'system'` unless there is a reason in writing here.
 */
export type FontId =
  | 'system'
  | 'segoe'
  | 'bahnschrift'
  | 'calibri'
  | 'trebuchet'
  | 'verdana'
  | 'georgia'
  | 'mono'
  | 'arial'
  | 'tahoma'
  | 'candara'
  | 'corbel'
  | 'cambria'
  | 'constantia'
  | 'sitka'

/**
 * One size for every style, literally. An x-height correction was tried here and
 * removed: scaling the size so that different typefaces *looked* equal moved the
 * chrome around them, which is worse than two fonts setting slightly
 * differently.
 */
export const FONTS: Record<FontId, { name: string; stack: string }> = {
  system: { name: 'System', stack: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif' },
  segoe: { name: 'Segoe UI', stack: '"Segoe UI", system-ui, sans-serif' },
  bahnschrift: { name: 'Bahnschrift', stack: 'Bahnschrift, "DIN Alternate", system-ui, sans-serif' },
  calibri: { name: 'Calibri', stack: 'Calibri, Candara, system-ui, sans-serif' },
  trebuchet: { name: 'Trebuchet', stack: '"Trebuchet MS", system-ui, sans-serif' },
  verdana: { name: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
  georgia: { name: 'Georgia', stack: 'Georgia, "Times New Roman", serif' },
  mono: { name: 'Mono', stack: '"Cascadia Mono", Consolas, ui-monospace, monospace' },
  arial: { name: 'Arial', stack: 'Arial, Helvetica, sans-serif' },
  tahoma: { name: 'Tahoma', stack: 'Tahoma, Geneva, sans-serif' },
  candara: { name: 'Candara', stack: 'Candara, Calibri, system-ui, sans-serif' },
  corbel: { name: 'Corbel', stack: 'Corbel, Calibri, system-ui, sans-serif' },
  cambria: { name: 'Cambria', stack: 'Cambria, Georgia, serif' },
  constantia: { name: 'Constantia', stack: 'Constantia, Cambria, Georgia, serif' },
  sitka: { name: 'Sitka Text', stack: '"Sitka Text", Constantia, Georgia, serif' }
}

export const STYLES: Style[] = [
  {
    id: 'aurora',
    name: 'Aurora',
    blurb: "Deep space. Prism's default.",
    mode: 'dark',
    // SOLID since 2026-09-20 (owner: "update this theme to be non acrylic by
    // default"). It shipped as acrylic at 35 on the slider, so Prism's own
    // default style let the desktop through the window it was showing a film
    // in. The Acrylic control is untouched and starts at 0 here: glass is a
    // thing to turn on, not a thing to turn off. `glass` is dropped with the
    // material, since it means nothing on a solid style.
    material: 'solid',
    bg: '#0b0d12',
    // One surface for the whole window. Turning the glass off shouldn't hand
    // the panel a tone of its own - separation here is the material, or the
    // Edges control, never a step in shade.
    side: '#0b0d12',
    title: '#0b0d12',
    text: '#f2f4f8',
    folderIcon: '#99bbff', // owner pick, 2026-08-22
    iconMode: 'kind',
    icon: '#8a8e99',
    // A brighter blue than the family indigo (owner pick, 2026-08-21); the
    // folder icons follow it, as they do every accent.
    accent: '#4682fb',
    font: 'system',
    size: '12.5',
    corners: '8',
    // Faint edges everywhere by default: the chrome traces itself even before
    // the material separates it. The accent glow the style launched with was
    // removed 2026-08-21: the glass alone is the look.
    borders: 'faint'
  },
  {
    id: 'default',
    name: 'Onyx',
    blurb: 'Glass over true black.',
    mode: 'dark',
    material: 'acrylic',
    bg: '#000000',
    side: '#141414',
    title: '#141414',
    text: '#eef0f4',
    folderIcon: '#8bb1fd', // owner pick, 2026-08-22
    iconMode: 'kind',
    icon: '#8a8e99',
    accent: 'prism',
    font: 'system',
    size: '12.5',
    corners: '2',
    borders: 'faint'
  },
  {
    id: 'new-void',
    name: 'Void',
    blurb: 'True black, faintly edged.',
    mode: 'dark',
    material: 'oled',
    bg: '#000000',
    side: '#000000',
    title: '#000000',
    text: '#e8eaf0',
    folderIcon: '#8688fd', // owner pick, 2026-08-22
    iconMode: 'dim',
    icon: '#8a8e99',
    accent: 's-indigo',
    font: 'system',
    size: '12.5',
    corners: '2',
    // On true black the edge lines are all the separation there is.
    borders: 'faint'
  },
  {
    id: 'terminal',
    name: 'Terminal',
    blurb: 'Green, square.',
    mode: 'dark',
    material: 'solid',
    bg: '#0b0f14',
    side: '#0d1117',
    title: '#11161d',
    text: '#d7e0d9',
    iconMode: 'custom',
    icon: '#3f9d54',
    accent: 's-green',
    font: 'system',
    size: '12.5',
    corners: '2',
    borders: 'faint'
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
    font: 'system',
    size: '12.5',
    corners: '8',
    borders: 'faint'
  },

  {
    id: 'acrylic-red',
    name: 'Ruby',
    blurb: 'Near-black, round corners, red.',
    mode: 'dark',
    // Solid since 2026-08-21 (the id predates the change and stays: it is a
    // saved-settings key, not a description).
    material: 'solid',
    // REPAINTED 2026-09-20, the owner's own picks off the Style page: it was a
    // night blue (#101420) with a crimson accent, and the blue was doing the
    // work a red style should do itself. Near-black lets the red be the only
    // colour in the window. bg, side and title are one value because the
    // material is solid and the one-surface rule derives the panel and the bar
    // from bg anyway (no sideOwn, no titleOwn): the two below are what the
    // schematic cards draw.
    bg: '#0d0d0d',
    side: '#0d0d0d',
    title: '#0d0d0d',
    text: '#eceef5',
    // A hex rather than a scheme id: s-crimson is #e01e4a, which is pink
    // beside this red. Both are the owner's picks.
    folderIcon: '#dc5656',
    iconMode: 'kind',
    icon: '#8a8e99',
    accent: '#e01f1f',
    font: 'system',
    size: '12.5',
    corners: '14',
    borders: 'faint'
  }
]

const LIGHT: Style[] = [
  // Paper leads: setMode picks the first style of a mode. Daybreak (Aurora's
  // daylight twin) was deleted 2026-08-21 with the accent glow it existed
  // for - glowless it was a flat-white copy of Paper.
  {
    id: 'paper',
    name: 'Paper',
    blurb: 'Solid white, Prism blue.',
    mode: 'light',
    // No acrylic on light styles by default (owner decision, 2026-08-21):
    // glass over a light desktop pulls the window grey. Frost is a slider away.
    material: 'solid',
    bg: '#fbfbfc',
    side: '#eceef1',
    title: '#e1e3e8',
    text: '#1b1d21',
    folderIcon: '#6296fe', // owner pick, 2026-08-22
    iconMode: 'kind',
    icon: '#6b7280',
    accent: 'prism',
    font: 'system',
    size: '12.5',
    corners: '8',
    borders: 'faint'
  },
  {
    id: 'frost',
    name: 'Frost',
    blurb: 'Cool white, deep teal.',
    mode: 'light',
    material: 'solid',
    bg: '#f4f8fb',
    side: '#e9f0f6',
    title: '#e9f0f6',
    text: '#152029',
    folderIcon: '#4d8f89', // owner pick, 2026-08-22
    iconMode: 'custom',
    icon: '#4a7d92',
    accent: 'd-teal',
    font: 'system',
    size: '12.5',
    corners: '14',
    borders: 'faint'
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
    font: 'system',
    size: '12.5',
    corners: '8',
    borders: 'faint'
  },
  {
    id: 'orchid',
    name: 'Orchid',
    blurb: 'Lilac, tinted by its own accent.',
    mode: 'light',
    material: 'tinted',
    bg: '#f7f1fb',
    side: '#efe4f7',
    title: '#e6d7f2',
    text: '#251a30',
    folderIcon: '#956eb4', // owner pick, 2026-08-22
    iconMode: 'custom',
    icon: '#6b21a8',
    accent: 'd-plum',
    font: 'system',
    size: '12.5',
    corners: '14',
    borders: 'faint'
  }
]

STYLES.push(...LIGHT)

export const DEFAULT_STYLE = 'aurora'

/* ---------- colour maths ---------- */

// The first SIX digits only: a colour may carry an alpha now (#249 rework),
// and parsing all eight shifted G, B and A into R, G and B.
const hex2rgb = (h: string): number[] => {
  const s = h.replace('#', '')
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s.slice(0, 6), 16)
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
/** `c` moved `t` of the way to the grey of its own lightness. */
const greyer = (c: string, t: number): string => {
  const [r, g, b] = hex2rgb(c)
  const y = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
  return mix(c, rgb2hex([y, y, y]), t)
}
export const rgba = (c: string, a: number): string => {
  const [r, g, b] = hex2rgb(c)
  return `rgba(${r},${g},${b},${a})`
}

/** `#rrggbb` of a stored `#rrggbb` or `#rrggbbaa`. */
const flatHex = (c: string): string => (c.length === 9 && c.startsWith('#') ? c.slice(0, 7) : c)

/** A stored colour's OWN alpha: eight digits carry one (`ff` included, which
 *  is "solid, on purpose"), six do not. Three decimals, as a CSS alpha. */
const ownAlpha = (c: string | undefined): number | null =>
  c && c.length === 9 && c.startsWith('#') ? Number((parseInt(c.slice(7), 16) / 255).toFixed(3)) : null

/**
 * The style with its see-through Text drawn as the eye gets it, opaque: laid
 * over the viewer and the sidebar, and kept at least as legible on both as
 * the same colour opaque, up to 4.5:1 (the core's `legibleOn`). Of the two
 * composites, the one whose worse ground reads better. An opaque Text, every
 * shipped style, is handed through untouched.
 */
function seenStyle(s: Style): Style {
  if (alphaOf(s.text) >= 1) return s
  const grounds = [opaque(s.bg), sideGround(s)]
  const worst = (c: string): number => Math.min(...grounds.map((g) => contrast(c, g)))
  const picks = grounds.map((g) => legibleOn(s.text, g, 4.5))
  const text = picks.reduce((a, b) => (worst(b) > worst(a) ? b : a))
  return { ...s, text }
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
 * Dim `text` towards `surface` by `amount`, backing off if that would drop below
 * `min` contrast. The target is a floor, not a destination: walking all the way
 * down to it is what left file names sitting on the legibility limit in pale
 * grey. A fixed fraction alone doesn't work either, since the same fraction
 * dims on a dark panel and washes out on a light one - hence both.
 */
export function dimmed(text: string, surface: string, amount: number, min: number): string {
  let t = amount
  let c = mix(text, surface, t)
  while (t > 0 && contrast(c, surface) < min) {
    t = Math.max(0, t - 0.05)
    c = mix(text, surface, t)
  }
  return c
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

/**
 * The selection for an accent worn at `alpha` (#249). At 1 it is exactly
 * selectionBg and its ink, so every style looks as it did. Below 1 it is the
 * core's `selectionFor` (moved there from this file, since both apps would
 * otherwise each write it): the label sits on the fill AS SEEN over every
 * ground the row can land on (the viewer, the sidebar and the title bar), and
 * the fill is nudged until the ink clears 4.5:1 on the worst of them. The
 * fill comes back opaque; the caller adds the alpha.
 */
export function selectionFor(
  accent: string,
  alpha: number,
  grounds: string[]
): { fill: string; ink: string } {
  const a = accentAlphaOf(alpha)
  if (a >= 1) {
    const fill = selectionBg(accent)
    return { fill, ink: readableOn(fill) }
  }
  return selectionOver(withAlpha(accent, a), grounds)
}

/**
 * A MARKED FILE IS A TINT, NOT A SLAB (owner, 2026-10-03, with a screenshot of
 * an opaque grey selection in the Explorer: "more transparent like selecting
 * files in file explorer"). Rows in the Explorer, the tree and search results
 * wear the accent at about a fifth over their ground with a faint accent edge,
 * and keep their own text and icon colours, as Windows does. The tint is taken
 * from the accent as picked, never from its alpha: the accent's alpha is a
 * choice about solid fills, and a tint that went fainter with it would vanish.
 */
export const TINT_ALPHA = 0.22
/** Below a tenth the tint stops reading as a mark at all. */
export const TINT_MIN = 0.1
/**
 * The edge round a marked row, at the tint's own strength. It was 0.5 and read
 * as a frame round the block (owner, 2026-10-03: "the border i think contrast
 * is slightly too much"); at 0.28 it is a hint of the block's outline, about
 * half the step off the tint it used to be, and still there on paper and on
 * void. A stronger or fainter picked tint scales it with itself, up to LINE_MAX.
 */
export const TINT_LINE = 0.28
/** The inactive mark's strength, as a share of the tint's (`--p-sel-tint-dim`). */
export const SEL_DIM = 0.75
const LINE_MAX = 0.5

/**
 * How strong the tint can be on these grounds while every ink still reads at
 * its floor: TINT_ALPHA where it can, less where a ground needs it. The inks
 * are the row's own colours, which stay as they are on a marked row, so it is
 * the tint that gives way.
 */
export function selectionTintAlpha(
  tint: string,
  inks: Array<[ink: string, floor: number]>,
  grounds: string[],
  start = TINT_ALPHA
): number {
  const reads = (a: number): boolean =>
    grounds.every((g) => {
      const seen = composite(withAlpha(tint, a), g)
      return inks.every(([ink, floor]) => contrast(ink, seen) >= floor)
    })
  // A picked Selection asks for its own strength (`start`, its alpha), and
  // gets it whole when the inks read on it; else whole percents down from
  // there, the steps the derived tint has always taken. A pick fainter than
  // TINT_MIN is the user's to make, so the floor is never above it.
  const floor = Math.min(TINT_MIN, start)
  if (reads(start)) return start
  for (let step = Math.ceil(start * 100) - 1; step > Math.round(floor * 100); step -= 1) {
    const a = step / 100
    if (reads(a)) return a
  }
  return floor
}

/** The edge's alpha for a tint of strength `a`: TINT_LINE at TINT_ALPHA. */
export const tintLineAlpha = (a: number): number => Math.min(LINE_MAX, (TINT_LINE * a) / TINT_ALPHA)

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
export function derive(input: Style): Record<string, string> {
  const style = seenStyle(input)
  const palette = accentOf(style.accent)
  const accent = palette[0]
  // The one surface, flat: panel and viewer are the same colour now, so the
  // contrast maths reads it once.
  const side = style.material === 'tinted' ? mix(style.bg, accent, 0.07) : style.bg
  const bg = style.material === 'tinted' ? mix(style.bg, accent, 0.07) : style.bg
  const light = style.mode === 'light'
  const kinds: Record<string, string> = {}
  for (const [k, v] of Object.entries(KIND_TINTS)) {
    // The tints were picked for a dark panel; on paper they need taking down.
    kinds['--p-kind-' + k] = light ? mix(v, '#000000', 0.42) : v
  }
  // The accent, taken far enough from the surface to be seen on it. A deep
  // copper or navy is invisible against its own panel otherwise, which is what
  // made the schematics vanish.
  // Far enough from the card (a ~5% wash over the page) that the schematic on
  // it doesn't read as white-on-white.
  const stage = mix(bg, style.text, light ? 0.16 : 0.13)
  // The accent, unless the accent can't be read where it is used. Shifting it by
  // habit - lighter on dark, darker on light - meant one accent looked like two
  // different colours depending on the mode it was wearing.
  // The opacity is for FILLS only (#249; the owner's pick): --p-accent-hi is
  // text, links and rings, so it starts from the accent at full strength and a
  // see-through accent never fades a Reset link or a focus ring.
  const alpha = accentAlphaOf(style.accentAlpha)
  let hi = accent
  for (let i = 0; i < 14 && contrast(hi, stage) < 3; i += 1) {
    hi = light ? mix(hi, '#000000', 0.1) : mix(hi, '#ffffff', 0.1)
  }

  const grounds = [...new Set([bg, sideGround(style), titleOf(style)].map((c) => c.toLowerCase()))]
  const selection = selectionFor(accent, alpha, grounds)
  // FILLS UNDER GLASS ARE FLATTENED (decision 5, owner 2026-10-03). On a
  // translucent style the ground behind a see-through fill is the desktop,
  // which nobody can measure, so a label on it cannot be held to 4.5:1. The
  // text-bearing fills are then published OPAQUE: the see-through fill as it
  // looks over the style's own flat ground. An opaque accent, or an opaque
  // style, is untouched.
  const flat = alpha < 1 && paintedAlpha(style) < 1 ? composite(withAlpha(selection.fill, alpha), bg) : null

  // File names sit just off the text colour; labels a step back; hints
  // quieter still, and none of them below their floor.
  const textSoft = dimmed(style.text, side, 0.14, 7)
  const dim = dimmed(style.text, side, 0.38, 4.5)
  const dim2 = dimmed(style.text, side, 0.55, 3.2)
  // The marked-file tint (see TINT_ALPHA): from `hi`, the accent already
  // moved far enough off the ground to be seen, so a deep accent on a dark
  // style still tints. Names hold 4.5:1 on it; the quiet columns beside them
  // (type, size, date) hold the 3.2:1 every hint in the app is held to.
  // A picked Selection (owner, 2026-10-03: the Explorer's highlight "should be
  // taken out and called something like selected item colour") is the tint's
  // colour and strength as picked, held to the same floors: past them only
  // its strength gives way, never its hue. Unset, it is `hi` at TINT_ALPHA,
  // byte for byte what it was before the row existed.
  const sideG = sideGround(style)
  const picked = style.selection ? parseColour(style.selection) : null
  const tintHue = picked ? toStored({ ...picked, a: 1 }) : hi
  const tintA = selectionTintAlpha(
    tintHue,
    [
      [style.text, 4.5],
      [textSoft, 4.5],
      [dim, 3.2]
    ],
    [bg, sideG],
    picked ? picked.a : TINT_ALPHA
  )
  const tint = withAlpha(tintHue, tintA)
  // THE MARK WHERE THE USER IS NOT (#296; owner, 2026-10-06, of File
  // Explorer's sidebar: "as soon as you click something in the main view
  // after that it gets dimmed, still highlighted but dimmed"). Windows'
  // inactive selection: the tint's hue mostly drained to a grey of its own
  // lightness, at SEL_DIM of its strength, so it reads as the same mark, quieter and
  // neutral. Held to the same ink floors as the tint (selectionTintAlpha), and
  // in theme.selection.test.ts to a visible step off the panel and off the
  // full tint, on every style.
  const dimHue = greyer(tintHue, 0.65)
  const dimA = selectionTintAlpha(
    dimHue,
    [
      [style.text, 4.5],
      [textSoft, 4.5],
      [dim, 3.2]
    ],
    [bg, sideG],
    Math.max(TINT_MIN, Math.round(tintA * SEL_DIM * 100) / 100)
  )
  // The sweep band's colour (Windows draws its drag box in the selection
  // colour): unset, the accent fill and `hi` it has always been drawn from, so
  // nobody's band changes; picked, the pick, lifted off the stage for its edge
  // the way `hi` is lifted from the accent.
  const accentFill = alpha >= 1 ? accent : (flat ?? fillOf(selection.fill, alpha))
  let bandHi = tintHue
  if (picked) {
    for (let i = 0; i < 14 && contrast(bandHi, stage) < 3; i += 1) {
      bandHi = light ? mix(bandHi, '#000000', 0.1) : mix(bandHi, '#ffffff', 0.1)
    }
  }

  // A DRIVE PAST 90% USED (#296; the drive row mockups, 2026-10-06): a warm
  // orange for its bar, ring or gauge, and a deeper or lighter one for its
  // number. The mockup's colours, each moved off the panel until it holds its
  // floor there (a mark 3:1, words 4.5:1), so a custom ground keeps them seen.
  let warn = light ? '#d05a1c' : '#f0894a'
  let warnInk = light ? '#b44d15' : '#f4a171'
  for (let i = 0; i < 14 && contrast(warn, side) < 3; i += 1) {
    warn = light ? mix(warn, '#000000', 0.1) : mix(warn, '#ffffff', 0.1)
  }
  for (let i = 0; i < 14 && contrast(warnInk, side) < 4.5; i += 1) {
    warnInk = light ? mix(warnInk, '#000000', 0.1) : mix(warnInk, '#ffffff', 0.1)
  }

  return {
    '--p-bg': bg,
    '--p-side-flat': side,
    '--p-warn': warn,
    '--p-warn-ink': warnInk,
    '--p-text': style.text,
    '--p-text-soft': textSoft,
    '--p-dim': dim,
    '--p-dim2': dim2,
    // A marked file row: the tint, its faint edge, and the tint as the eye
    // gets it over the viewer and over the sidebar, opaque, for an icon's
    // knockouts (a see-through knockout would show the icon's own ink).
    '--p-sel-tint': tint,
    '--p-sel-line': withAlpha(tintHue, tintLineAlpha(tintA)),
    '--p-sel-tint-seen': composite(tint, bg),
    '--p-sel-tint-side': composite(tint, sideG),
    // The same mark while the user acts elsewhere (see `dimHue`): a place in
    // the sidebar after a click in the list, a list row after one in the
    // sidebar.
    '--p-sel-tint-dim': withAlpha(dimHue, dimA),
    '--p-sel-line-dim': withAlpha(dimHue, tintLineAlpha(dimA)),
    '--p-sel-tint-dim-seen': composite(withAlpha(dimHue, dimA), bg),
    // The sweep band: its fill's colour and its edge's (see `bandHi`).
    '--p-sel-hue': picked ? tintHue : accentFill,
    '--p-sel-hue-hi': picked ? bandHi : hi,
    // A FILL: carries the opacity (#249), and is the plain hex at 100%.
    // Below 100% it is the SELECTION's fill, not the raw accent: buttons and
    // chips print --p-on-accent on it, and that ink was chosen so the
    // selection's fill clears 4.5:1 on every ground. The raw accent at the
    // same alpha does not (MEASURED in review: Frost at 80% gave 3.78:1).
    '--p-accent': accentFill,
    // The accent as picked, never see-through: lines, rings, a progress bar
    // against its track and native controls, which the alpha must not reach
    // (the owner's pick was fills only).
    '--p-accent-solid': accent,
    // What a file icon's knockouts paint with on a selected row: the row's
    // fill as the eye gets it, opaque, since a see-through knockout would let
    // the icon's own ink show through it. At 100% it is the accent, as the
    // rows have always passed.
    '--p-sel-knockout': alpha >= 1 ? accent : composite(withAlpha(selection.fill, alpha), bg),
    // The same for a row on the SIDEBAR (the tree, search results), which a
    // style may colour apart from the viewer: a knockout mixed over the
    // viewer's ground would show there as a patch inside the icon.
    '--p-sel-knockout-side':
      alpha >= 1 ? accent : (flat ?? composite(withAlpha(selection.fill, alpha), sideGround(style))),
    // The selection as the eye gets it, opaque, on the viewer's ground: for
    // a knockout that has always painted --p-sel-bg (the browse list), so it
    // looks as it did at 100% and is not see-through below it.
    '--p-sel-seen': alpha >= 1 ? selection.fill : composite(withAlpha(selection.fill, alpha), bg),
    '--p-accent-hi': hi,
    // A raised stage rather than a sunken one: a true-black style has nothing
    // darker to go to, so this always steps towards the text colour.
    '--p-preview': stage,
    // Form controls (selects, switches, small buttons). Quieter than the
    // stage: on true black the 13% wash read as a light grey block, and the
    // controls want to sit INTO the page, not on a platform.
    // Quieter on dark than it was (5% read harsh on true black); the control
    // border follows --p-divider now too, so Void's controls sit into the
    // page instead of outlined in white.
    '--p-control': mix(bg, style.text, light ? 0.09 : 0.035),
    // The unfilled part of a progress bar, and any other inert track: it sits
    // ON the stage, so a divider-strength grey disappears there.
    '--p-track': mix(stage, style.text, light ? 0.34 : 0.26),
    // The selection is a fill too, and its ink is chosen against it AS SEEN.
    '--p-sel-bg': flat ?? fillOf(selection.fill, alpha),
    '--p-on-accent': selection.ink,
    ...kinds
  }
}

/* ---------- applying a style ---------- */

/** The colours an accent stands for: a named scheme, or one hex of your own. */
export const paletteOf = (accent: string): string[] =>
  accent.startsWith('#') ? [accent] : (THEMES.find((t) => t.id === accent)?.palette ?? ['#5b5bd6'])

const accentOf = paletteOf

/** A visualizer scheme, with the one that follows the app's accent filled in.
 *  Everything that draws with a scheme goes through here rather than
 *  themeById, because 'accent' has no colour of its own until now.
 *
 *  The result is cached until the accent actually changes. It is read during
 *  render, and the Visualizer restarts its draw loop when the palette changes:
 *  handing back a fresh array every render restarted it every render, which
 *  looks exactly like a colour that makes the visualizer stutter. */
let accentScheme: VizTheme | null = null
export function resolveVizTheme(id: string): VizTheme {
  const base = themeById(id)
  if (id !== ACCENT_THEME_ID) return base
  const colour = accentOf(edited(byId(current)).accent)[0]
  if (accentScheme === null || accentScheme.accent !== colour) {
    accentScheme = { ...base, palette: [colour], accent: colour }
  }
  return accentScheme
}

/**
 * Every custom property a style publishes, as one object.
 *
 * `paint` writes these to the document; anything that has to draw a style it
 * isn't currently wearing - the setup's mode transition, for one - can apply
 * the same set to a subtree instead. It has to be the whole set: handing over
 * only the derived half is what left a transition wearing the old title bar.
 *
 * `opaque` drops the translucency a material would otherwise add. A copy of the
 * window drawn over the window can't have the desktop behind it, so it paints
 * the style's flat colours and lets the real thing take over the glass.
 */
export function variablesFor(input: Style, opaque = false): Record<string, string> {
  const style = seenStyle(input)
  const palette = accentOf(style.accent)
  const accent = palette[0]

  // One surface, whatever the material.
  //
  // A style used to carry three colours - viewer, panel, title bar - and the
  // step between them was how the chrome separated itself. On glass that reads
  // as three mismatched panes, and turning the glass off brought the step
  // straight back, so the same window looked assembled from parts at 0% and
  // seamless at 60%. The window is one surface at every level now, and what
  // separates the panel from the viewer is the Edges control, or the material
  // behind it - never a change of shade.
  //
  // `side` and `title` are kept on Style for the styles you have saved and for
  // the schematics, which still draw a panel so a card reads as a window.
  // `sideOwn` narrows the one-surface rule rather than reversing it (owner,
  // 2026-09-03): the panel takes the user's chosen colour, carried at the
  // material's own alpha so glass stays one sheet; everything else still
  // derives from bg.
  // A panel colour of EIGHT digits carries an alpha of its own (decision 2,
  // owner 2026-10-03): painted at it, glass or not. Six digits follow the
  // material's alpha as they always did. The flat colour is the first six.
  const ownSide = style.sideOwn ? flatHex(style.side) : null
  const ownTitle = style.titleOwn ? flatHex(style.title) : null
  const ownTabs = style.tabsOwn && style.tabs ? flatHex(style.tabs) : null
  const sideA = style.sideOwn ? ownAlpha(style.side) : null
  const titleA = style.titleOwn ? ownAlpha(style.title) : null
  const tabsA = style.tabsOwn && style.tabs ? ownAlpha(style.tabs) : null
  let bg = style.bg
  let side = ownSide ?? style.bg
  let title = ownTitle ?? style.bg
  const translucent = style.material === 'acrylic' || style.material === 'mica'
  const glass = translucent && !opaque ? paintedAlpha(style) : 1
  if (translucent && !opaque) {
    // Windows composites the material behind the window; the surfaces sit on
    // top of it, so they have to let it through - all at the same alpha, or
    // they read as panes butted together rather than one sheet.
    bg = rgba(style.bg, glass)
    side = ownSide ? rgba(ownSide, sideA ?? glass) : bg
    title = ownTitle ? rgba(ownTitle, titleA ?? glass) : bg
  } else if (style.material === 'gradient') {
    const grad = `linear-gradient(180deg, ${lighten(style.bg, 0.06)}, ${style.bg})`
    side = ownSide ?? grad
    title = ownTitle ?? grad
  } else if (style.material === 'tinted') {
    bg = mix(style.bg, accent, 0.07)
    side = ownSide ?? bg
    title = ownTitle ?? bg
  }
  // An own alpha on an opaque material: the panel alone is see-through.
  if (!(translucent && !opaque)) {
    if (ownSide && sideA !== null && sideA < 1) side = rgba(ownSide, sideA)
    if (ownTitle && titleA !== null && titleA < 1) title = rgba(ownTitle, titleA)
  }
  // THE TAB BAR IS THE SECONDARY COLOUR, ALL OF IT (owner, 2026-09-03): the
  // strip, the tabs at rest and the tab you are on are one surface with the
  // sidebar and the title bar, so a black secondary is a black bar from end
  // to end. Two earlier cuts stepped something off something - the active
  // tab off the strip, then the strip off the active tab - and both were
  // sent back. The active tab is told by its ink (text against dim), not by
  // a fill. A tab-bar colour of its own still moves the bar; both tokens
  // carry the material's alpha.
  const tabsAlpha = tabsA ?? glass
  const tabs = ownTabs ? (tabsA !== null || glass < 1 ? rgba(ownTabs, tabsAlpha) : ownTabs) : title
  const tabActive = tabs

  const ink = style.mode === 'light' ? '#000000' : '#ffffff'
  const divider =
    style.borders === 'none'
      ? 'transparent'
      : style.borders === 'strong'
        ? rgba(ink, style.mode === 'light' ? 0.18 : 0.16)
        : style.borders === 'faint'
          ? // A third of a hairline: edges you sense more than see.
            rgba(ink, style.mode === 'light' ? 0.035 : 0.022)
          : rgba(ink, style.mode === 'light' ? 0.1 : 0.07)

  // The same hairline, but OPAQUE (2026-08-23). --p-divider is an alpha over
  // whatever sits behind it, which is right for edges inside a panel and
  // wrong for the one edge that stands against the VIEWER: over a playing
  // video the line sampled the picture and appeared to shimmer, lighter and
  // darker down its length. Mixed into the panel's own flat colour it looks
  // identical and holds still.
  const dividerAlpha =
    style.borders === 'none'
      ? 0
      : style.borders === 'strong'
        ? style.mode === 'light' ? 0.18 : 0.16
        : style.borders === 'faint'
          ? style.mode === 'light' ? 0.035 : 0.022
          : style.mode === 'light' ? 0.1 : 0.07
  // As SEEN: a see-through panel over a solid window is the blend of the two.
  const flatSide = sideGround(style)
  const edge = style.borders === 'none' ? 'transparent' : mix(flatSide, ink, dividerAlpha)
  // The tab strip's flat colour (#253): what a see-through agent tint is laid
  // on before its ink is chosen. --p-tabs carries the material's alpha (or is
  // a gradient), and contrast needs one opaque colour.
  const tabsFlat = tabsOf(style)

  // A hairline that exists whatever the style says about edges. Settings lists
  // need their rows separated even in a style that draws no chrome lines.
  const listLine = rgba(ink, style.mode === 'light' ? 0.12 : 0.09)

  // CHROME icons (buttons: sort, terminal, close) are SHARED, not styled: one
  // dim derivation from the style's own ink, every style. iconMode used to
  // reach here too, and Ruby's accent mode painted every control red at rest -
  // a difference no user could edit away (owner decision, 2026-08-21).
  // iconMode still shapes the TREE's default icon colours below.
  const icon = dimmed(style.text, style.bg, 0.38, 4.5)

  // The wash comes from the accent, so picking a colour tints the whole window
  // with it. Lighter styles take less: the same alpha over white is a stain.
  const washA = palette[0]
  const washB = palette[1] ?? mix(palette[0], style.mode === 'light' ? '#000000' : '#ffffff', 0.35)
  // Light takes more, not less: the same alpha that reads as a glow on
  // near-black barely lifts off white.
  const washAlpha = style.mode === 'light' ? 0.28 : 0.22

  // THE TOOLBAR'S FIELDS, the address and the search (#267): one fill, one
  // edge. On a near-black ground (measured) a darker fill and an edge that
  // carries the shape; elsewhere the search's own control fill and divider.
  const flat = derive(style)
  const field = nearBlackField(flat['--p-bg'], style.text)
  const fieldFill = field?.fill ?? flat['--p-control']

  return {
    ...flat,
    '--p-field': fieldFill,
    '--p-field-edge': field?.edge ?? divider,
    '--p-field-edge-hover': field?.edgeHover ?? rgba(ink, style.mode === 'light' ? 0.18 : 0.16),
    '--p-field-hint': hintOn(flat['--p-dim'], style.text, fieldFill),
    // bg and side carry their material; the derived pair above is the flat one.
    '--p-bg': bg,
    '--p-side': side,
    // The flat colour of that one surface: the tree and the contrast maths read
    // it, and neither wants an rgba.
    '--p-side-flat': flatSide,
    '--p-title': title,
    '--p-tabs': tabs,
    '--p-tab-active': tabActive,
    '--p-tabs-flat': tabsFlat,
    '--p-icon': icon,
    // The tree's icon colours, both user-pickable. The folder default is the
    // family indigo (kind styles) or the style's own icon tone; the file token
    // only paints when the tree is NOT in per-kind tints.
    '--p-tree-folder': folderIconOf(style),
    '--p-tree-file': fileIconOf(style),
    '--p-tree-archive': archiveIconOf(style),
    // THE CONTAINER FOLLOWS THE FOLDER COLOUR (owner, 2026-09-20: "the zip file
    // icon should have dynamically adjusting colours based on the accent, just
    // like folders, they should follow the same setting. and not be hardcoded
    // blue"). A zip kept ICON_COLOURS' indigo page while every other icon in
    // the tree was monochrome, so one row in a folder wore a colour nothing in
    // the style had chosen. It is the FOLDER token itself rather than a second
    // derivation of the accent: a zip is a container, and "the same setting" is
    // what was asked for, so the Folder icons picker moves both.
    '--p-tree-zip': folderIconOf(style),
    // What is drawn ON that page: the seam and the pull, white or near-black,
    // THE BETTER OF THE TWO. Not `readableOn`, which is the rule for TEXT on
    // the accent and leans towards white by 1.4x: on Ruby's own #dc5656 that
    // leaning picks white at 3.8:1 where near-black reads at 5.0:1, and this
    // is a mark on an icon rather than a word. The scheme's flat black would
    // vanish outright the moment somebody picked a dark folder colour.
    '--p-tree-zip-ink': zipInkOn(folderIconOf(style)),
    '--p-hover': rgba(ink, style.mode === 'light' ? 0.07 : 0.06),
    // The held highlight (a row whose context menu is open): the hover look,
    // five points stronger, so it reads as "this one" rather than "passing by".
    '--p-hover-hi': rgba(ink, style.mode === 'light' ? 0.12 : 0.11),
    '--p-divider': divider,
    '--p-edge': edge,
    '--p-line': listLine,
    // `none` is a valid background-image, so a style without a wash draws none.
    '--p-wash': style.wash
      ? `radial-gradient(58% 56% at 20% 22%, ${rgba(washA, washAlpha)}, transparent 72%),` +
        ` radial-gradient(54% 52% at 80% 78%, ${rgba(washB, washAlpha * 0.9)}, transparent 72%)`
      : 'none',
    '--p-radius': style.corners + 'px',
    // SHARED, not styled: small controls (the folder button, tree rows) keep
    // one shape everywhere. Deriving this from the style's corners turned
    // Ruby's 26px buttons into circles - a control shape the user cannot edit
    // must not vary by theme (owner decision, 2026-08-21).
    '--p-radius-sm': '3px',
    // The style's face, worn by the sidebar and the title bar only. Terminal in
    // mono is a look; Settings in mono is a mistake, and every long line of
    // running text in the app lives outside the chrome.
    '--p-font': FONTS[style.font].stack,
    '--p-font-ui': FONTS.system.stack,
    '--p-size': style.size + 'px',
    '--p-row': (style.size === '13.5' ? 31 : style.size === '12' ? 22 : 26) + 'px',
    '--p-indent': (style.size === '13.5' ? 15 : style.size === '12' ? 11 : 13) + 'px'
  }
}

/** The tree's folder colour: the chosen one, or the style's ACCENT by default
 *  (owner decision, 2026-08-21) - stepped toward readability against the
 *  panel the same way --p-accent-hi is, so a dark accent on a dark style
 *  still reads. Changing the accent recolours the folders with it. */
/** The sidebar's effective flat colour: the user's own pick, else the derived
 *  one-surface answer. What the Settings well shows. */
export const sideOf = (s: Style): string =>
  s.sideOwn
    ? flatHex(s.side)
    : s.material === 'tinted'
      ? mix(s.bg, paletteOf(s.accent)[0], 0.07)
      : s.bg

/**
 * The sidebar as the eye gets it, opaque: what every ink and fill on the panel
 * is measured against. A panel with an alpha of its own over a SOLID window is
 * that panel laid over the window, which is knowable, so it is the blend
 * (review of #251). On glass the desktop behind is not, so it is the flat
 * colour, as for every panel without an own alpha.
 */
export const sideGround = (s: Style): string => {
  const a = s.sideOwn ? ownAlpha(s.side) : null
  if (a === null || a >= 1 || s.material === 'acrylic' || s.material === 'mica') return sideOf(s)
  const under = s.material === 'tinted' ? mix(s.bg, paletteOf(s.accent)[0], 0.07) : s.bg
  return composite(s.side, opaque(under))
}

// The tree's inks measure against the SIDEBAR's own ground, not bg: they live
// on the panel, and the panel can wear its own colour now (sideOwn). For every
// style without one, sideOf is bg and nothing changes.
/** The title bar's effective flat colour, for its Settings well. */
export const titleOf = (s: Style): string =>
  s.titleOwn
    ? flatHex(s.title)
    : s.material === 'tinted'
      ? mix(s.bg, paletteOf(s.accent)[0], 0.07)
      : s.bg

/** The tab bar's effective flat colour, for its Settings well: its own pick,
 *  else the title bar's. */
export const tabsOf = (s: Style): string => (s.tabsOwn && s.tabs ? flatHex(s.tabs) : titleOf(s))

export const folderIconOf = (s: Style): string => {
  // A see-through pick is drawn as it looks on the panel, and never less
  // legible there than the same colour opaque (a mark's 3:1 floor, the core's
  // `legibleOn`). An opaque pick is drawn exactly as picked.
  if (s.folderIcon) return alphaOf(s.folderIcon) < 1 ? legibleOn(s.folderIcon, sideGround(s), 3) : s.folderIcon
  const ground = sideGround(s)
  let c = paletteOf(s.accent)[0]
  for (let i = 0; i < 14 && contrast(c, ground) < 3; i += 1) {
    c = s.mode === 'light' ? mix(c, '#000000', 0.1) : mix(c, '#ffffff', 0.1)
  }
  return c
}

/**
 * The tree's file ink: the chosen one, else WHITE OR BLACK, whichever reads
 * better on the style's own ground (owner instruction, 2026-08-31 - "they
 * should either be white or black depending on the background").
 *
 * It replaces a 0.38 dimming of the theme's text, which was a mid-tone BY
 * CONSTRUCTION and so could never be either. The file's KIND lives in the
 * glyph's shape (2026-08-21); the ink only has to be legible.
 *
 * MEASURED, not read off the mode flag: Prism has custom styles, so "is this
 * theme dark" has no reliable answer while "what does this ground measure"
 * always does. And it takes the BETTER OF THE TWO ratios rather than testing a
 * midpoint - two colours either side of a midpoint can both be poor, while
 * better-of-two is right by construction. Mid-grey #808080 is the case that
 * shows it: black at 5.32:1 against white's 5.28:1, which a midpoint test
 * would have called a coin toss.
 *
 * The dark half is not pure black (owner, 2026-08-31: "a bit less black"). It
 * is the ground's own colour taken almost all the way down, which softens it
 * and picks up the paper's temperature at the same time - a warm off-white
 * style gets a warm ink rather than a cold one sitting on it. Still 13.6:1 at
 * worst across the shipped light styles, against pure black's 18.9:1, so
 * nothing is bought at the cost of legibility. The light half stays #ffffff:
 * white on a dark ground is what it always was and is not what was complained
 * about.
 *
 * THERE IS NO LONGER A PICKER OVER IT (2026-09-01). The Settings control that
 * set an arbitrary `fileIcon` became a switch of icon TYPES - monochrome, which
 * is exactly this rule, or the coloured preset scheme in `iconPaths.ts`. So the
 * derivation IS monochrome rather than its default, and a style carrying a
 * `fileIcon` from before the switch has nothing to read it: an unreachable
 * colour with no control left to change it is worse than the measured rule it
 * would be overriding.
 *
 * `s.bg` is the ground rather than the resolved panel because a tinted
 * material only washes 7% of the accent over it, which cannot move a
 * background from one side of this to the other.
 */
export const fileIconOf = (s: Style): string => {
  const ground = sideGround(s)
  const dark = mix('#000000', ground, 0.14)
  return contrast('#ffffff', ground) >= contrast(dark, ground) ? '#ffffff' : dark
}

/** The parcel FALLBACK colour (#68): archives normally wear the system's own
 *  association icon, and this amber - stepped toward readability like the
 *  folder colour - covers the moment before it loads and machines where
 *  Windows has none to give. Not user-facing; the picker was removed
 *  (owner decision 2026-08-22) once the system icon became the icon. */
/** The ink for a mark drawn on a chosen colour: white or near-black, whichever
 *  measures better on it. The floor a GRAPHIC has to clear is 3:1, not text's
 *  4.5:1, and the better of the two clears it on anything the folder picker
 *  can hand over (a mid-grey, the worst case, measures about 4.4:1). */
export const zipInkOn = (bg: string): string =>
  contrast('#ffffff', bg) >= contrast('#0b0d12', bg) ? '#ffffff' : '#0b0d12'

export const archiveIconOf = (s: Style): string => {
  const ground = sideGround(s)
  let c = '#d9a53f'
  for (let i = 0; i < 14 && contrast(c, ground) < 3; i += 1) {
    c = s.mode === 'light' ? mix(c, '#000000', 0.1) : mix(c, '#ffffff', 0.1)
  }
  return c
}

function paint(style: Style): void {
  const r = document.documentElement.style
  for (const [k, v] of Object.entries(variablesFor(style))) r.setProperty(k, v)

  document.documentElement.dataset.mode = style.mode
  // A translucent style needs the window itself to be transparent, which only
  // the main process can arrange.
  const translucent = style.material === 'acrylic' || style.material === 'mica'
  if (typeof window !== 'undefined') {
    window.prism?.setWindowMaterial(translucent ? style.material : 'none', style.mode)
  }
}

/* ---------- edits, and saving them ---------- */

// A style is a starting point, not a cage. Changing a colour puts the app in an
// edited state: nothing in the picker is selected any more, because what you are
// looking at is no longer any of the shipped styles. From there you either save
// it as a preset of your own, or click a card to go back to it.
export interface Overrides {
  /** Id of a scheme in viz THEMES. */
  accent?: string
  bg?: string
  /** The sidebar's own colour; unset, the panel derives from bg. */
  side?: string
  /** The title bar's own colour; unset, it derives from bg. */
  title?: string
  /** The tab bar's own colour; unset, it follows the title bar. */
  tabs?: string
  text?: string
  /** How much frost, 0 (opaque) to 100 (glassiest). */
  acrylic?: number
  font?: FontId
  /** The chrome's edge lines. On glass they are often the only thing still
   *  cutting the window into pieces, so they are yours to turn off. */
  borders?: Style['borders']
  corners?: Style['corners']
  folderIcon?: string
  iconScheme?: IconScheme
  /** The accent fills' opacity, 0.1 to 1 (#249). */
  accentAlpha?: number
  /** The marked-file tint, with its alpha (#257). */
  selection?: string
}

const HEX6_8 = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i

/** A colour as stored: kept as written when it is six or eight hex digits
 *  (a panel's `ff` means "its own, solid", so it is not folded to six), any
 *  other parseable spelling in the core's stored form, and null for junk. */
function cleanColour(v: unknown): string | null {
  if (typeof v !== 'string') return null
  if (HEX6_8.test(v)) return v.toLowerCase()
  const p = parseColour(v)
  return p ? toStored(p) : null
}

/**
 * A draft as read from storage. An opacity that is not a number is dropped (it
 * would count as an edit and paint as solid), the rest held to range; every
 * colour is checked, and one that is not a colour is forgotten. Primary's
 * alpha is the glass level, so a Primary of eight digits (pasted, or an old
 * local draft) is split into the colour and that level; an accent of eight
 * digits into the colour and its alpha.
 */
export function cleanDraft(o: Overrides): Overrides {
  if (!o || typeof o !== 'object') return {}
  const next: Overrides = { ...o }
  for (const k of ['bg', 'side', 'title', 'tabs', 'text', 'folderIcon', 'selection'] as const) {
    if (!(k in next)) continue
    const c = cleanColour(next[k])
    if (c) next[k] = c
    else delete next[k]
  }
  if (next.bg && alphaOf(next.bg) < 1) {
    if (typeof next.acrylic !== 'number') next.acrylic = levelFor(alphaOf(next.bg))
    next.bg = opaque(next.bg)
  }
  if ('accent' in next) {
    if (typeof next.accent !== 'string' || !next.accent) delete next.accent
    else if (next.accent.startsWith('#') || !/^[a-z0-9-]+$/i.test(next.accent)) {
      const c = cleanColour(next.accent)
      if (!c) delete next.accent
      else {
        if (alphaOf(c) < 1 && next.accentAlpha === undefined) next.accentAlpha = alphaOf(c)
        next.accent = opaque(c)
      }
    }
  }
  if ('acrylic' in next) {
    if (typeof next.acrylic !== 'number' || !Number.isFinite(next.acrylic)) delete next.acrylic
    else next.acrylic = Math.round(Math.min(100, Math.max(0, next.acrylic)))
  }
  if ('accentAlpha' in next) {
    if (typeof next.accentAlpha !== 'number' || !Number.isFinite(next.accentAlpha)) delete next.accentAlpha
    else next.accentAlpha = accentAlphaOf(next.accentAlpha)
  }
  return next
}

/**
 * The saved presets as read from storage, through the same checks as the
 * draft. A preset whose Primary or Text is not a colour is dropped (there is
 * nothing to draw it with); an optional colour that is not one is forgotten;
 * a Primary of eight digits becomes the colour plus the glass it stands for.
 */
export function cleanPresets(raw: unknown): Style[] {
  if (!Array.isArray(raw)) return []
  const out: Style[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || typeof (item as Style).id !== 'string') continue
    const s = { ...(item as Style) }
    const bg = cleanColour(s.bg)
    const text = cleanColour(s.text)
    if (!bg || !text) continue
    s.bg = opaque(bg)
    s.text = text
    if (alphaOf(bg) < 1) {
      const level = levelFor(alphaOf(bg))
      if (level > 0) {
        if (s.material !== 'mica') s.material = 'acrylic'
        s.glass = glassAt(level)
      }
    }
    for (const k of ['side', 'title', 'tabs', 'folderIcon', 'selection'] as const) {
      if (s[k] === undefined) continue
      const c = cleanColour(s[k])
      if (c) s[k] = c
      else delete s[k]
    }
    if (s.side === undefined) s.side = s.bg
    if (s.title === undefined) s.title = s.bg
    out.push(s)
  }
  return out
}

// The surface alpha a style paints at, when it hasn't said otherwise.
const defaultGlass = (s: Style): number =>
  s.material === 'acrylic' ? (s.mode === 'light' ? 0.5 : 0.55) : 0.82

/**
 * The alpha a translucent style actually paints its surfaces at; 1 for an
 * opaque material. The number is what the old stack came to: the page and the
 * app shell used to lay the window colour underneath every surface, and one
 * coat of the bare alpha is far more see-through than three were. Exported so
 * the style cards can frost at exactly the alpha the window does.
 */
export function paintedAlpha(s: Style): number {
  if (s.material !== 'acrylic' && s.material !== 'mica') return 1
  const a = s.glass ?? defaultGlass(s)
  return 1 - (1 - a * 0.75) ** 3
}

// The slider's two ends, in surface alpha: opaque-ish glass to barely there.
const GLASS_MAX = 0.85
const GLASS_SPAN = 0.55

/** Where a style sits on the acrylic slider, 0 for a style with no frost. */
export function acrylicLevel(s: Style): number {
  if (s.material !== 'acrylic' && s.material !== 'mica') return 0
  const a = s.glass ?? defaultGlass(s)
  return Math.round(Math.min(100, Math.max(0, ((GLASS_MAX - a) / GLASS_SPAN) * 100)))
}

/* ---------- Primary's alpha IS the old Acrylic slider (decision 1) ---------- */

// Owner, 2026-10-03: alpha "should be built into the colour pickers ... it
// should not be a separate opacity setting", and of the Acrylic slider: the
// Primary colour's alpha replaces it, "under the slider's own rule", saved
// levels mapping 1:1. So the level stays what is STORED (the draft's
// `acrylic`, a preset's `glass`) and the alpha is only how it is SHOWN: the
// alpha the window paints at that level. Nothing saved is converted, so no
// window changes on update; a level is written only when the alpha is moved.

/** The surface glass the slider wrote for a level, 1 to 100. */
const glassAt = (level: number): number => GLASS_MAX - (level / 100) * GLASS_SPAN
const paintedAt = (level: number): number => 1 - (1 - glassAt(level) * 0.75) ** 3

/** The slider's two ends as painted alphas: about 53% and 95%. */
export const PRIMARY_ALPHA_MIN = paintedAt(100)
export const PRIMARY_ALPHA_MAX = paintedAt(1)

/** What the Primary picker may hold: solid, or a glass the slider could
 *  reach. Between the glassiest-but-one end and solid it is the top of the
 *  glass, since nothing in between exists (the slider had no 0.5). */
export function snapPrimaryAlpha(a: number): number {
  if (a >= 1) return 1
  return Math.min(PRIMARY_ALPHA_MAX, Math.max(PRIMARY_ALPHA_MIN, a))
}

/** The slider level whose painted alpha is nearest `alpha`; 0 (solid) at 1. */
export function levelFor(alpha: number): number {
  if (!(alpha < 1)) return 0
  let best = 1
  for (let level = 2; level <= 100; level += 1) {
    if (Math.abs(paintedAt(level) - alpha) < Math.abs(paintedAt(best) - alpha)) best = level
  }
  return best
}

/** Primary as the picker shows it: the colour, at the alpha it paints. */
export const primaryValue = (s: Style): string => withAlpha(opaque(s.bg), paintedAlpha(s))

/** Secondary as the picker shows it: an alpha of its own when it has one,
 *  else the material's (decision 2). */
export function secondaryValue(s: Style): string {
  const own = s.sideOwn ? ownAlpha(s.side) : null
  return withAlpha(sideOf(s), own ?? paintedAlpha(s))
}

const DRAFT_KEY = 'prism.style.draft'
const PRESETS_KEY = 'prism.style.presets'

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* no storage: it lasts the session */
  }
}

let presets: Style[] = cleanPresets(loadJson<unknown>(PRESETS_KEY, []))
let draft: Overrides = cleanDraft(loadJson<Overrides>(DRAFT_KEY, {}))

/** Shipped styles plus the user's saved presets. */
export const allStyles = (): Style[] => [...STYLES, ...presets]

/** Are we looking at an edited style rather than a saved one? */
export const isEdited = (): boolean =>
  !!(
    draft.accent ||
    draft.bg ||
    draft.side ||
    draft.title ||
    draft.tabs ||
    draft.text ||
    draft.font ||
    draft.borders ||
    draft.corners ||
    draft.folderIcon ||
    draft.iconScheme ||
    draft.selection ||
    draft.accentAlpha !== undefined ||
    draft.acrylic !== undefined
  )

function edited(s: Style): Style {
  if (!isEdited()) return s
  const out: Style = {
    ...s,
    accent: draft.accent ?? s.accent,
    bg: draft.bg ?? s.bg,
    side: draft.side ?? s.side,
    sideOwn: draft.side ? true : s.sideOwn,
    title: draft.title ?? s.title,
    titleOwn: draft.title ? true : s.titleOwn,
    tabs: draft.tabs ?? s.tabs,
    tabsOwn: draft.tabs ? true : s.tabsOwn,
    text: draft.text ?? s.text,
    font: draft.font ?? s.font,
    borders: draft.borders ?? s.borders,
    corners: draft.corners ?? s.corners,
    folderIcon: draft.folderIcon ?? s.folderIcon,
    iconScheme: draft.iconScheme ?? s.iconScheme,
    accentAlpha: draft.accentAlpha ?? s.accentAlpha,
    selection: draft.selection ?? s.selection
  }
  if (out.accentAlpha === undefined) delete out.accentAlpha
  if (out.selection === undefined) delete out.selection
  if (draft.acrylic !== undefined) {
    // Zero frost is just a solid window; anything above it is acrylic at the
    // alpha the slider asks for.
    // A mica style stays mica: only the glass moves (decision 1's rule).
    out.material = draft.acrylic <= 0 ? 'solid' : s.material === 'mica' ? 'mica' : 'acrylic'
    if (draft.acrylic > 0) out.glass = GLASS_MAX - (draft.acrylic / 100) * GLASS_SPAN
  }
  return out
}

/* ---------- the store ---------- */

const KEY = 'prism.style'
const MODE_KEY = 'prism.mode'

const byId = (id: string): Style => allStyles().find((s) => s.id === id) ?? STYLES[0]

function load(): string {
  try {
    const v = localStorage.getItem(KEY)
    return v ?? DEFAULT_STYLE
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
// A preset that has since been deleted leaves a dangling id; normalise it.
current = allStyles().some((s) => s.id === current) ? current : DEFAULT_STYLE
let mode: Mode = loadMode()
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach((l) => l())
const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

// The list changes when presets are saved or deleted; components watch this.
let version = 0

/** Repaint from whatever is current, and keep the bar and visualizer in step. */
function apply(syncAccent = true): void {
  const style = edited(byId(current))
  paint(style)
  // A scheme that already follows the accent must not be replaced by the
  // accent's own named scheme: it is following on purpose. The visualizer and
  // the progress bar are answered separately, since either can be set to a
  // colour of its own.
  if (syncAccent && !style.accent.startsWith('#')) {
    if (vizState().theme !== ACCENT_THEME_ID) setTheme(style.accent)
    if (vizState().barTheme !== ACCENT_THEME_ID) setBarTheme(style.accent)
  }
  emit()
}

/** Switch to a style, saved or shipped. Any unsaved edit is dropped - clicking
 *  the card you started from is how you get back to it. */
export function setStyle(id: string): void {
  current = byId(id).id
  draft = {}
  saveJson(DRAFT_KEY, draft)
  localStorage.setItem(KEY, current)
  // A new style brings its own terminal: the terminal theme returns to
  // follow-style with stock settings. A saved Custom setup stays saved and
  // reselectable.
  setTermThemeId('style')
  resetTermExtras()
  apply()
}

/**
 * THE PANELS ARE ONE PICK (owner, 2026-09-03): the sidebar, the title bar
 * and the tab bar move together, because changing one of them means you
 * should probably adjust the others as well. The model keeps them apart -
 * a saved style may still carry three different colours - but the well
 * writes and clears all three at once. Pure, so it is testable.
 */
export function withChrome(o: Overrides, value: string | null): Overrides {
  const next: Overrides = { ...o }
  if (value) {
    next.side = value
    next.title = value
    next.tabs = value
  } else {
    delete next.side
    delete next.title
    delete next.tabs
  }
  return next
}

/**
 * A COLOUR PUT BACK IS NOT AN EDIT (owner, 2026-09-03): picking your way back
 * to the very colour the style had left an override equal to the base and
 * a reset button offering to change nothing. The well only knows it was
 * written, so the test lives where the write happens. The chrome pick is
 * "back" only when all three panels agree with the style, since a saved
 * style may keep them apart. Pure, so it is testable.
 */
export function isStylesOwn(base: Style, role: string, value: string): boolean {
  // Judged on the colour, not its spelling (`#ABC`, `#aabbccff`), through the
  // core's stored form; a scheme id is compared as it is.
  const key = (c: string): string => {
    const p = c.startsWith('#') ? parseColour(c) : null
    return p ? toStored(p) : c.toLowerCase()
  }
  const same = (a: string | undefined): boolean => !!a && key(a) === key(value)
  switch (role) {
    case 'chrome':
      return same(sideOf(base)) && same(titleOf(base)) && same(tabsOf(base))
    case 'side':
      return same(sideOf(base))
    case 'title':
      return same(titleOf(base))
    case 'tabs':
      return same(tabsOf(base))
    default:
      return same((base as unknown as Record<string, string | undefined>)[role])
  }
}

/** Change one colour role of what is on screen, or clear it with null. */
export function setOverride(
  role:
    | 'accent'
    | 'bg'
    | 'side'
    | 'title'
    | 'tabs'
    | 'chrome'
    | 'text'
    | 'font'
    | 'borders'
    | 'corners'
    | 'folderIcon'
    | 'iconScheme'
    | 'selection',
  value: string | null
): void {
  let next: Overrides = { ...draft }
  if (value && isStylesOwn(byId(current), role, value)) value = null
  if (role === 'chrome') next = withChrome(next, value)
  else if (value)
    next[role] = value as FontId & Style['borders'] & Style['corners'] & IconScheme & string
  else delete next[role]
  draft = next
  saveJson(DRAFT_KEY, draft)
  apply()
}

/** How much of the desktop shows through, 0 to 100. */
export function setAcrylic(level: number | null): void {
  const next: Overrides = { ...draft }
  if (level === null) delete next.acrylic
  else next.acrylic = Math.round(level)
  draft = next
  saveJson(DRAFT_KEY, draft)
  apply()
}

/** How solid the accent's fills are, 0.1 to 1, or null to give the style's
 *  own back. Its own value put back is not an edit, as with a colour. */
export function setAccentAlpha(level: number | null): void {
  const next: Overrides = { ...draft }
  const own = accentAlphaOf(byId(current).accentAlpha)
  const value = level === null ? null : accentAlphaOf(level)
  if (value === null || value === own) delete next.accentAlpha
  else next.accentAlpha = value
  draft = next
  saveJson(DRAFT_KEY, draft)
  apply()
}

/** The accent row's Reset: the colour AND its opacity, in one repaint. */
export function resetAccent(): void {
  const next: Overrides = { ...draft }
  delete next.accent
  delete next.accentAlpha
  draft = next
  saveJson(DRAFT_KEY, draft)
  apply()
}

/** Write a draft and repaint, once. */
function commitDraft(next: Overrides): void {
  draft = next
  saveJson(DRAFT_KEY, draft)
  apply()
}

/** A colour role set on a draft, or cleared when it is the style's own. */
function withColour(next: Overrides, role: 'bg' | 'chrome' | 'accent', value: string): Overrides {
  // A panel colour with an alpha of its own (eight digits, `ff` included) is
  // judged on its spelling: `isStylesOwn` compares stored forms, where `ff`
  // drops, so a solid panel on glass in the colour it already had read as the
  // style's own put back and was thrown away (review of #251).
  const base = byId(current)
  const own =
    role === 'chrome' && value.length === 9
      ? [
          base.sideOwn ? base.side : sideOf(base),
          base.titleOwn ? base.title : titleOf(base),
          base.tabsOwn && base.tabs ? base.tabs : tabsOf(base)
        ].every((c) => c.toLowerCase() === value.toLowerCase())
      : isStylesOwn(base, role, value)
  if (role === 'chrome') return withChrome(next, own ? null : value)
  if (own) delete next[role]
  else next[role] = value
  return next
}

/**
 * The Primary row's picker (decision 1). The colour's six digits are the
 * background; its alpha is the Acrylic slider's level, written ONLY when the
 * alpha moved, so a hue edit never touches the material or the glass. A level
 * that is the style's own is no edit, as with a colour put back.
 */
export function setPrimary(stored: string): void {
  const p = parseColour(stored)
  if (!p) return
  const shown = edited(byId(current))
  let next: Overrides = { ...draft }
  const hex = toStored({ ...p, a: 1 })
  if (hex !== opaque(shown.bg)) next = withColour(next, 'bg', hex)
  if (Math.round(p.a * 255) !== Math.round(paintedAlpha(shown) * 255)) {
    const level = levelFor(p.a)
    if (level === acrylicLevel(byId(current))) delete next.acrylic
    else next.acrylic = level
  }
  commitDraft(next)
}

/**
 * The Secondary row's picker (decision 2). Six digits while its alpha is the
 * material's (it keeps following Primary's level); eight once the alpha has
 * been moved, and then its own through any later hue edit. An own alpha of
 * 100 is kept as `ff`, so a solid panel on glass is possible and is not read
 * as following.
 */
export function setSecondary(stored: string): void {
  const p = parseColour(stored)
  if (!p) return
  const shown = edited(byId(current))
  const hex = toStored({ ...p, a: 1 })
  const hasOwn = shown.sideOwn && ownAlpha(shown.side) !== null
  const follows = !hasOwn && Math.round(p.a * 255) === Math.round(paintedAlpha(shown) * 255)
  const value = follows ? hex : p.a >= 1 ? hex + 'ff' : toStored(p)
  commitDraft(withColour({ ...draft }, 'chrome', value))
}

/**
 * The Accent row's picker. The alpha is stored beside the accent, since a
 * scheme accent is an id and keeps its palette for the visualizer: an alpha
 * edit leaves the scheme alone, a colour edit leaves the alpha alone.
 */
export function setAccentColour(stored: string): void {
  const p = parseColour(stored)
  if (!p) return
  const shown = edited(byId(current))
  let next: Overrides = { ...draft }
  const hex = toStored({ ...p, a: 1 })
  if (hex !== opaque(paletteOf(shown.accent)[0])) next = withColour(next, 'accent', hex)
  const a = accentAlphaOf(p.a)
  if (Math.round(a * 255) !== Math.round(accentAlphaOf(shown.accentAlpha) * 255)) {
    if (a === accentAlphaOf(byId(current).accentAlpha)) delete next.accentAlpha
    else next.accentAlpha = a
  }
  commitDraft(next)
}

/**
 * THE SELECTION IS ITS OWN COLOUR (#257; owner, 2026-10-03: "the settings
 * accent colour for the tab should be separated from the explorer accent
 * colour ... called something like selected item colour"). What the Selection
 * row shows: the pick as stored, or, unset, the tint the accent gives today,
 * so the picker opens on what is on screen.
 */
export function selectionValue(s: Style): string {
  return s.selection ?? derive(s)['--p-sel-tint']
}

/**
 * The Selection row's picker. The colour is stored WITH its alpha, which is
 * the tint's strength. Picking your way back to what the style gives (its own
 * pick, or the accent's tint when it has none) is not an edit, as with any
 * colour put back.
 */
export function setSelection(stored: string): void {
  const p = parseColour(stored)
  if (!p) return
  const value = toStored(p)
  const base = byId(current)
  const shown = edited(base)
  const next: Overrides = { ...draft }
  const own = base.selection
    ? isStylesOwn(base, 'selection', value)
    : value === selectionValue({ ...shown, selection: undefined })
  if (own) delete next.selection
  else next.selection = value
  commitDraft(next)
}

/** A picker's Escape: the keys it may have written put back exactly as they
 *  were when it opened, absent included. */
export function restoreOverrides(snapshot: Overrides, keys: Array<keyof Overrides>): void {
  const next: Overrides = { ...draft }
  for (const k of keys) {
    if (snapshot[k] === undefined) delete next[k]
    else (next as Record<string, unknown>)[k] = snapshot[k]
  }
  commitDraft(next)
}

/** The draft as it stands, for a picker to take a snapshot of. */
export const overridesNow = (): Overrides => draft

/** What is on screen, outside React. */
export const currentStyle = (): Style => edited(byId(current))

/** Keep the current edit as a preset of its own, and select it. */
export function savePreset(): void {
  const base = byId(current)
  // Numbered in their own series rather than named after wherever they started:
  // "Paper custom copy" says nothing about what it looks like now.
  const taken = new Set(allStyles().map((s) => s.name.toLowerCase()))
  let n = 1
  while (taken.has(`custom theme ${n}`)) n += 1
  const name = `Custom theme ${n}`
  const preset: Style = {
    ...edited(base),
    id: 'custom-' + String(version) + '-' + String(presets.length + 1) + '-' + name.replace(/\W+/g, ''),
    name,
    custom: true,
    base: base.custom ? base.base : base.id
  }
  presets = [...presets, preset]
  saveJson(PRESETS_KEY, presets)
  version += 1
  setStyle(preset.id)
}

/** Remove one of the user's presets. Shipped styles can't be deleted. */
export function deletePreset(id: string): void {
  const gone = presets.find((s) => s.id === id)
  if (!gone) return
  presets = presets.filter((s) => s.id !== id)
  saveJson(PRESETS_KEY, presets)
  version += 1
  if (current === id) {
    // Land somewhere real: the style it grew out of, else the first in this mode.
    const home = gone.base && byId(gone.base).id === gone.base ? gone.base : stylesFor(mode)[0]?.id
    setStyle(home ?? DEFAULT_STYLE)
  } else emit()
}

/**
 * THE SCHEME SWITCH IS HIDDEN (owner, 2026-09-01: "hide that color setting for
 * now and make default monochrome we might come bakc to it").
 *
 * Everything that resolves a scheme goes through here, so putting the control
 * back is this one constant plus the Pref block in Settings. Forcing the answer
 * rather than only removing the control is deliberate: a style saved while the
 * switch existed still carries `iconScheme: 'colour'`, and leaving that live
 * would strand whoever set it with a scheme and no way to change it.
 *
 * The zip and the comic are coloured regardless - see ICON_ALWAYS_COLOUR - so
 * this is about the SET, not about whether any icon may carry colour.
 */
export const ICON_SCHEME_SHOWN = false

/** Which icon set a style draws its file rows with. Unset means monochrome. */
export const iconSchemeOf = (s: Style): IconScheme =>
  ICON_SCHEME_SHOWN ? (s.iconScheme ?? 'mono') : 'mono'

/** The live icon scheme, for the components that draw a file icon. */
export function useIconScheme(): IconScheme {
  useSyncExternalStore(subscribe, () => current)
  useSyncExternalStore(subscribe, () => draft)
  return iconSchemeOf(edited(byId(current)))
}

/** The edits sitting on top of the selected style. */
export function useOverrides(): Overrides {
  return useSyncExternalStore(subscribe, () => draft)
}

/** Dark or light. Each mode has its own styles, so switching picks the first. */
export function setMode(m: Mode): void {
  mode = m
  localStorage.setItem(MODE_KEY, m)
  const first = allStyles().find((s) => s.mode === m)
  if (first) setStyle(first.id)
  else emit()
}

/** What is on screen: the selected style with any unsaved edits applied. */
export function useStyle(): Style {
  useSyncExternalStore(subscribe, () => current)
  useSyncExternalStore(subscribe, () => draft)
  return edited(byId(current))
}

/** The id of the selected card, or null while the style is edited. */
export function useSelectedId(): string | null {
  useSyncExternalStore(subscribe, () => draft)
  const id = useSyncExternalStore(subscribe, () => current)
  return isEdited() ? null : id
}

export function useMode(): Mode {
  return useSyncExternalStore(subscribe, () => mode)
}

/** The styles for a mode, shipped then saved. Re-reads when presets change. */
export function useStyles(m: Mode): Style[] {
  useSyncExternalStore(subscribe, () => version)
  return stylesFor(m)
}

export const stylesFor = (m: Mode): Style[] => allStyles().filter((s) => s.mode === m)

// Paint before first render so nothing flashes the wrong colour.
paint(edited(byId(current)))

// On a fresh install the visualizer and the progress bar have no colour of their
// own yet, so they take the style's accent. Once you've picked one, it stands.
try {
  if (!localStorage.getItem('prism.viz.theme')) setTheme(byId(current).accent)
  if (!localStorage.getItem('prism.viz.barTheme')) setBarTheme(byId(current).accent)
} catch {
  /* no storage: the defaults in vizStore stand */
}

// Shared preferences arrive without calling this window's setters. Refresh the
// cached objects before a later edit can overwrite another window's saved theme.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.storageArea !== localStorage) return
    if (event.key !== null && ![KEY, MODE_KEY, PRESETS_KEY, DRAFT_KEY].includes(event.key)) return
    presets = cleanPresets(loadJson<unknown>(PRESETS_KEY, []))
    draft = cleanDraft(loadJson<Overrides>(DRAFT_KEY, {}))
    current = load()
    mode = loadMode()
    version += 1
    // The originating window already saved related accent preferences. Receiving
    // its changes must not write them back or reset this window's terminal style.
    apply(false)
  })
}
