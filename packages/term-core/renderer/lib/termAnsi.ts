import { DEFAULT_GROUND } from '../../shared/ground'
import { contrastRatio, luminance, mixHex, normalizeColor, towardRoom } from './colourMath'
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

/* The small colour maths (normalizeColor, mixHex, luminance, contrastRatio,
 * towardRoom) lives in colourMath.ts; re-exported so the palette's callers
 * keep their import. */
export { contrastRatio, luminance, mixHex, normalizeColor, towardRoom } from './colourMath'

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
  const towards = towardRoom(bg)
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
  const bg = normalizeColor(rawBg, DEFAULT_GROUND)
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

/**
 * A palette with every one of the sixteen legible against `bg` (2026-09-04,
 * owner: every command should read on every theme). Curated schemes were
 * kept exact before this, and most of them hide something: bright black -
 * which PSReadLine paints parameters, operators and its inline prediction
 * in - measured 1.0-2.7:1 on a dozen dark presets, and the light presets
 * carried a bright white (numbers, members) at 1.0:1, which is invisible.
 * Only a colour that FAILS the floor is touched, and it moves the least it
 * can, so a scheme that already reads keeps its exact colours.
 */
export function legiblePalette<T extends Ansi16 | Record<string, string>>(ansi: T, bg: string): T {
  // Inputs normalised first (#112): a colour that is not plain #rrggbb (an
  // rgba(), a hex8 with its alpha) must never reach hexToRgb, which reads it
  // as NaN. A plain #rrggbb passes through as it is, case and all.
  const plain = (c: string, fallback: string): string => (/^#[0-9a-f]{6}$/i.test(c) ? c : normalizeColor(c, fallback))
  const ground = plain(bg, DEFAULT_GROUND)
  const out: Record<string, string> = { ...ansi }
  for (const k of Object.keys(out)) out[k] = ensureContrast(plain(out[k], '#888888'), ground)
  return out as T
}
