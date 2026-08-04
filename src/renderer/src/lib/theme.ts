import { useSyncExternalStore } from 'react'
import { ACCENT_THEME_ID, THEMES, themeById } from './viz/styles'
import type { VizTheme } from './viz/core'
import { setBarTheme, setTheme, vizState } from './vizStore'

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

export type FontId = 'system' | 'segoe' | 'bahnschrift' | 'calibri' | 'trebuchet' | 'verdana' | 'georgia' | 'mono'

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
  mono: { name: 'Mono', stack: '"Cascadia Mono", Consolas, ui-monospace, monospace' }
}

export const STYLES: Style[] = [
  {
    id: 'aurora',
    name: 'Aurora',
    blurb: "Glass over deep space, lit by its own accent. Prism's default.",
    mode: 'dark',
    material: 'acrylic',
    // Glass and a wash together: the desktop comes through the surfaces, the
    // accent glows over them. 0.6575 is 35 on the Acrylic slider.
    glass: 0.6575,
    bg: '#0b0d12',
    // One surface for the whole window. Turning the glass off shouldn't hand
    // the panel a tone of its own - separation here is the material, or the
    // Edges control, never a step in shade.
    side: '#0b0d12',
    title: '#0b0d12',
    text: '#f2f4f8',
    iconMode: 'kind',
    icon: '#8a8e99',
    accent: 'prism',
    font: 'system',
    size: '12.5',
    corners: '8',
    borders: 'none',
    // The light that gives the style its name: two soft glows, opposite corners,
    // in whatever the accent currently is.
    wash: true
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
    iconMode: 'kind',
    icon: '#8a8e99',
    accent: 'prism',
    font: 'system',
    size: '12.5',
    corners: '2',
    // Glass and edge lines together cut the window into panes; the material
    // is what separates the surfaces here.
    borders: 'none'
  },
  {
    id: 'new-void',
    name: 'Void',
    blurb: 'True black. No glass, no edges.',
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
    name: 'Terminal',
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
    id: 'acrylic-red',
    name: 'Ruby',
    blurb: 'Glass, round corners, crimson.',
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
  }
]

const LIGHT: Style[] = [
  // Daybreak leads: setMode picks the first style of a mode, so the light half
  // of the app opens on Aurora's daylight twin rather than plain Paper.
  {
    id: 'daybreak',
    name: 'Daybreak',
    blurb: 'Aurora in daylight: the same glow, over solid white.',
    mode: 'light',
    // Solid, not glass. Acrylic over a light desktop pulls the whole window
    // grey, and grey is the one thing a light style cannot afford: artwork with
    // white in it stops reading as white. The glow stays; the translucency goes.
    material: 'solid',
    bg: '#fbfcfe',
    side: '#fbfcfe',
    title: '#fbfcfe',
    text: '#0f1319',
    iconMode: 'kind',
    icon: '#6b7280',
    accent: 'prism',
    font: 'system',
    size: '12.5',
    corners: '8',
    borders: 'none',
    wash: true
  },
  {
    id: 'paper',
    name: 'Paper',
    blurb: 'Acrylic over white, Prism blue.',
    mode: 'light',
    material: 'acrylic',
    // No dividers: the three surfaces are stepped far enough apart to separate
    // themselves, which is the whole point of a style with no edge lines.
    bg: '#fbfbfc',
    side: '#eceef1',
    title: '#e1e3e8',
    text: '#1b1d21',
    iconMode: 'kind',
    icon: '#6b7280',
    accent: 'prism',
    font: 'system',
    size: '12.5',
    corners: '8',
    borders: 'none'
  },
  {
    id: 'frost',
    name: 'Frost',
    blurb: 'Glass, cool white, deep teal.',
    mode: 'light',
    material: 'acrylic',
    // Frost is the glassiest of the set: more of the desktop comes through than
    // Paper lets past.
    glass: 0.4,
    bg: '#f4f8fb',
    side: '#e9f0f6',
    title: '#e9f0f6',
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
    id: 'orchid',
    name: 'Orchid',
    blurb: 'Lilac, tinted by its own accent.',
    mode: 'light',
    material: 'tinted',
    bg: '#f7f1fb',
    side: '#efe4f7',
    title: '#e6d7f2',
    text: '#251a30',
    iconMode: 'accent',
    icon: '#6b21a8',
    accent: 'd-plum',
    font: 'trebuchet',
    size: '12.5',
    corners: '14',
    borders: 'none'
  }
]

STYLES.push(...LIGHT)

export const DEFAULT_STYLE = 'aurora'

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
  let hi = accent
  for (let i = 0; i < 14 && contrast(hi, stage) < 3; i += 1) {
    hi = light ? mix(hi, '#000000', 0.1) : mix(hi, '#ffffff', 0.1)
  }

  return {
    '--p-bg': bg,
    '--p-side-flat': side,
    '--p-text': style.text,
    // File names sit just off the text colour; labels a step back; hints
    // quieter still, and none of them below their floor.
    '--p-text-soft': dimmed(style.text, side, 0.14, 7),
    '--p-dim': dimmed(style.text, side, 0.38, 4.5),
    '--p-dim2': dimmed(style.text, side, 0.55, 3.2),
    '--p-accent': accent,
    '--p-accent-hi': hi,
    // A raised stage rather than a sunken one: a true-black style has nothing
    // darker to go to, so this always steps towards the text colour.
    '--p-preview': stage,
    // The unfilled part of a progress bar, and any other inert track: it sits
    // ON the stage, so a divider-strength grey disappears there.
    '--p-track': mix(stage, style.text, light ? 0.34 : 0.26),
    '--p-sel-bg': selectionBg(accent),
    '--p-on-accent': readableOn(selectionBg(accent)),
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
export function variablesFor(style: Style, opaque = false): Record<string, string> {
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
  let bg = style.bg
  let side = style.bg
  let title = style.bg
  const translucent = style.material === 'acrylic' || style.material === 'mica'
  if (translucent && !opaque) {
    // Windows composites the material behind the window; the surfaces sit on
    // top of it, so they have to let it through - all at the same alpha, or
    // they read as panes butted together rather than one sheet.
    const glass = paintedAlpha(style)
    bg = rgba(style.bg, glass)
    side = bg
    title = bg
  } else if (style.material === 'gradient') {
    const grad = `linear-gradient(180deg, ${lighten(style.bg, 0.06)}, ${style.bg})`
    side = grad
    title = grad
  } else if (style.material === 'tinted') {
    bg = mix(style.bg, accent, 0.07)
    side = bg
    title = bg
  }

  const ink = style.mode === 'light' ? '#000000' : '#ffffff'
  const divider =
    style.borders === 'none'
      ? 'transparent'
      : style.borders === 'strong'
        ? rgba(ink, style.mode === 'light' ? 0.18 : 0.16)
        : rgba(ink, style.mode === 'light' ? 0.1 : 0.07)

  // A hairline that exists whatever the style says about edges. Settings lists
  // need their rows separated even in a style that draws no chrome lines.
  const listLine = rgba(ink, style.mode === 'light' ? 0.12 : 0.09)

  const icon =
    style.iconMode === 'text'
      ? style.text
      : style.iconMode === 'accent'
        ? accent
        : style.iconMode === 'custom'
          ? style.icon
          : dimmed(style.text, style.bg, 0.38, 4.5)

  // The wash comes from the accent, so picking a colour tints the whole window
  // with it. Lighter styles take less: the same alpha over white is a stain.
  const washA = palette[0]
  const washB = palette[1] ?? mix(palette[0], style.mode === 'light' ? '#000000' : '#ffffff', 0.35)
  // Light takes more, not less: the same alpha that reads as a glow on
  // near-black barely lifts off white.
  const washAlpha = style.mode === 'light' ? 0.28 : 0.22

  return {
    ...derive(style),
    // bg and side carry their material; the derived pair above is the flat one.
    '--p-bg': bg,
    '--p-side': side,
    // The flat colour of that one surface: the tree and the contrast maths read
    // it, and neither wants an rgba.
    '--p-side-flat': style.material === 'tinted' ? mix(style.bg, accent, 0.07) : style.bg,
    '--p-title': title,
    '--p-icon': icon,
    '--p-hover': rgba(ink, style.mode === 'light' ? 0.07 : 0.06),
    '--p-divider': divider,
    '--p-line': listLine,
    // `none` is a valid background-image, so a style without a wash draws none.
    '--p-wash': style.wash
      ? `radial-gradient(58% 56% at 20% 22%, ${rgba(washA, washAlpha)}, transparent 72%),` +
        ` radial-gradient(54% 52% at 80% 78%, ${rgba(washB, washAlpha * 0.9)}, transparent 72%)`
      : 'none',
    '--p-radius': style.corners + 'px',
    '--p-radius-sm': Math.max(2, Number(style.corners) - 2) + 'px',
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

function paint(style: Style): void {
  const r = document.documentElement.style
  for (const [k, v] of Object.entries(variablesFor(style))) r.setProperty(k, v)
  document.documentElement.dataset.icons = style.iconMode
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
  text?: string
  /** How much frost, 0 (opaque) to 100 (glassiest). */
  acrylic?: number
  font?: FontId
  /** The chrome's edge lines. On glass they are often the only thing still
   *  cutting the window into pieces, so they are yours to turn off. */
  borders?: Style['borders']
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

let presets: Style[] = loadJson<Style[]>(PRESETS_KEY, [])
let draft: Overrides = loadJson<Overrides>(DRAFT_KEY, {})

/** Shipped styles plus the user's saved presets. */
export const allStyles = (): Style[] => [...STYLES, ...presets]

/** Are we looking at an edited style rather than a saved one? */
export const isEdited = (): boolean =>
  !!(draft.accent || draft.bg || draft.text || draft.font || draft.borders || draft.acrylic !== undefined)

function edited(s: Style): Style {
  if (!isEdited()) return s
  const out: Style = {
    ...s,
    accent: draft.accent ?? s.accent,
    bg: draft.bg ?? s.bg,
    text: draft.text ?? s.text,
    font: draft.font ?? s.font,
    borders: draft.borders ?? s.borders
  }
  if (draft.acrylic !== undefined) {
    // Zero frost is just a solid window; anything above it is acrylic at the
    // alpha the slider asks for.
    out.material = draft.acrylic <= 0 ? 'solid' : 'acrylic'
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
  apply()
}

/** Change one colour role of what is on screen, or clear it with null. */
export function setOverride(role: 'accent' | 'bg' | 'text' | 'font' | 'borders', value: string | null): void {
  const next: Overrides = { ...draft }
  if (value) next[role] = value as FontId & Style['borders'] & string
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
