// The adaptive ANSI palette: sixteen syntax colours DERIVED from a background
// instead of assumed. The stock palette presumes near-black; the moment a
// style's background is edited towards red, stock red text vanishes into it.
// Each colour here keeps its hue identity (red stays in the red family) and
// walks its lightness until it clears a contrast floor against the actual
// background - so the terminal stays readable on any base a style can take.
//
// Mirrored (by hand, with a pointer back here) in tools/theme-lab/index.html.

export interface Ansi16 {
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

/* ---------- small colour maths, self-contained on purpose ---------- */

/**
 * Any CSS colour a style can publish, flattened to opaque #rrggbb: #rgb,
 * #rrggbb, #rrggbbaa, rgb() and rgba(). Alpha is dropped - an acrylic
 * surface's tint is the best stand-in for what text actually sits on.
 * Unparseable input returns the fallback: the maths must NEVER see NaN,
 * which is exactly how every hue once walked itself to pure black.
 */
export function normalizeColor(input: string, fallback: string): string {
  const v = input.trim()
  let m = /^#([0-9a-f]{3})$/i.exec(v)
  if (m) return '#' + m[1].split('').map((c) => c + c).join('').toLowerCase()
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(v)
  if (m) return '#' + m[1].toLowerCase()
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(v)
  if (m) return rgbToHex(Number(m[1]), Number(m[2]), Number(m[3]))
  return fallback
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)]
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number): string => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** Linear-interpolate two colours. t=0 is a, t=1 is b. */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t)
}

function luminance(hex: string): number {
  const lin = (n: number): number => {
    const c = n / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  const [r, g, b] = hexToRgb(hex)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG contrast ratio, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/* ---------- the derivation ---------- */

// The hue seeds: the classic palette's identities, before adaptation.
const SEEDS = {
  red: '#e05561',
  green: '#8cc265',
  yellow: '#d1a54b',
  blue: '#4aa5f0',
  magenta: '#c162de',
  cyan: '#42b3c2',
  bright: {
    red: '#ff616e',
    green: '#a5e075',
    yellow: '#f0c366',
    blue: '#4dc4ff',
    magenta: '#de73ff',
    cyan: '#4cd1e0'
  }
}

/** Text-on-terminal floor. 3:1 is WCAG's large-text line; syntax colour at
 *  13px reads fine at it, and demanding 4.5 washes every hue toward grey. */
export const ANSI_CONTRAST_FLOOR = 3

/**
 * Walk `colour` toward white or black - whichever direction the background
 * leaves room in - until it clears the floor. Steps are small so hue bleaches
 * as little as the floor allows.
 */
export function ensureContrast(colour: string, bg: string, floor = ANSI_CONTRAST_FLOOR): string {
  if (contrastRatio(colour, bg) >= floor) return colour
  // Walk toward whichever endpoint actually has room. A luminance threshold
  // gets mid-lightness backgrounds wrong: on a lavender, "lighter" runs out
  // of contrast before the floor, while black has plenty.
  const towards = contrastRatio('#ffffff', bg) >= contrastRatio('#000000', bg) ? '#ffffff' : '#000000'
  let c = colour
  for (let i = 0; i < 24 && contrastRatio(c, bg) < floor; i += 1) {
    c = mixHex(c, towards, 0.08)
  }
  // A background can sit where even the best endpoint barely clears the
  // floor; hand back the endpoint rather than something short of it.
  return contrastRatio(c, bg) >= floor ? c : towards
}

/**
 * The sixteen, adapted to `bg` and `fg`. The greys (black/white pairs) come
 * from the background and foreground themselves, so they always belong to the
 * theme; the twelve hues are the seeds pushed to readability.
 */
export function deriveAnsi(rawBg: string, rawFg: string): Ansi16 {
  const bg = normalizeColor(rawBg, '#101215')
  const fg = normalizeColor(rawFg, '#e3e6ea')
  const dark = luminance(bg) <= 0.35
  const adapt = (c: string): string => ensureContrast(c, bg)
  return {
    // "black" is a step off the background (visible boxes, not holes);
    // brightBlack is the muted-text grey between bg and fg.
    black: mixHex(bg, fg, dark ? 0.18 : 0.25),
    brightBlack: ensureContrast(mixHex(bg, fg, 0.55), bg),
    white: ensureContrast(mixHex(fg, bg, 0.18), bg),
    brightWhite: ensureContrast(fg, bg),
    red: adapt(SEEDS.red),
    green: adapt(SEEDS.green),
    yellow: adapt(SEEDS.yellow),
    blue: adapt(SEEDS.blue),
    magenta: adapt(SEEDS.magenta),
    cyan: adapt(SEEDS.cyan),
    brightRed: adapt(SEEDS.bright.red),
    brightGreen: adapt(SEEDS.bright.green),
    brightYellow: adapt(SEEDS.bright.yellow),
    brightBlue: adapt(SEEDS.bright.blue),
    brightMagenta: adapt(SEEDS.bright.magenta),
    brightCyan: adapt(SEEDS.bright.cyan)
  }
}
