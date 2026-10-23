import { contrastRatio, mixHex, towardRoom } from './termAnsi'

// ONE COLOUR, WITH ALPHA, FOR EVERY COLOUR SETTING IN BOTH APPS (#112; owner,
// 2026-10-03: "the colour pickers should be the same for both apps, i need an
// input field for a color code and an alpha per colour on every colour setting
// colour picker"; and earlier, alpha "should be built into the colour pickers
// like argb or ... hsl ..., it should not be a separate opacity setting").
// Spec: docs/superpowers/specs/2026-10-03-colour-picker-alpha-design.md.
//
// Pure: the picker's maths, the one stored form, and the contrast rules a
// see-through colour is held to. `termAnsi.normalizeColor` stays what it is,
// the opaque reader the palette maths use.

/** r, g, b 0..255 (fractions allowed on the way through), a 0..1. */
export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}
/** h 0..360, s and v 0..100, a 0..1. */
export interface Hsva {
  h: number
  s: number
  v: number
  a: number
}
/** h 0..360, s and l 0..100, a 0..1. */
export interface Hsla {
  h: number
  s: number
  l: number
  a: number
}
export type ColourFormat = 'hex' | 'rgba' | 'hsla'

export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))
const byte = (n: number): string => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0')

/* ---------- parse ---------- */

/** A number, or a number followed by `%` (scaled by `pct`), or null. */
function num(tok: string, pct?: number): number | null {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))(%?)$/.exec(tok)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  if (m[2]) return pct === undefined ? null : n * pct
  return n
}

/** An alpha token: 0..1 or 0%..100%. */
function alphaTok(tok: string | undefined): number | null {
  if (tok === undefined) return 1
  const n = num(tok, 0.01)
  return n === null || n < 0 || n > 1 ? null : n
}

/** The arguments of a functional colour: comma syntax, or space syntax with
 *  an optional `/ alpha`. */
function args(body: string): string[] | null {
  const s = body.trim()
  if (s.includes(',')) {
    const parts = s.split(',').map((p) => p.trim())
    return parts.every(Boolean) ? parts : null
  }
  const [main, alpha, ...rest] = s.split('/')
  if (rest.length) return null
  const parts = main.trim().split(/\s+/).filter(Boolean)
  if (alpha !== undefined) {
    if (!alpha.trim()) return null
    parts.push(alpha.trim())
  }
  return parts
}

/**
 * Every form the code field takes: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`
 * (the `#` optional), `rgb()`/`rgba()` and `hsl()`/`hsla()` in comma or space
 * syntax, alpha as 0-1 or a percentage. Anything else is null, and so is a
 * channel out of range: `rgb(300,0,0)` is a typo, not red.
 */
export function parseColour(text: string): Rgba | null {
  const v = text.trim().toLowerCase()
  if (!v) return null
  const hex = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v)
  if (hex) {
    const s = hex[1].length <= 4 ? [...hex[1]].map((c) => c + c).join('') : hex[1]
    return {
      r: parseInt(s.slice(0, 2), 16),
      g: parseInt(s.slice(2, 4), 16),
      b: parseInt(s.slice(4, 6), 16),
      a: s.length === 8 ? parseInt(s.slice(6, 8), 16) / 255 : 1
    }
  }
  const fn = /^(rgba?|hsla?)\((.*)\)$/.exec(v)
  if (!fn) return null
  const parts = args(fn[2])
  if (!parts || parts.length < 3 || parts.length > 4) return null
  const a = alphaTok(parts[3])
  if (a === null) return null
  if (fn[1].startsWith('rgb')) {
    const ch = parts.slice(0, 3).map((p) => num(p, 2.55))
    if (ch.some((c) => c === null || c < 0 || c > 255)) return null
    const [r, g, b] = ch as number[]
    return { r, g, b, a }
  }
  const h = num(parts[0].replace(/deg$/, ''))
  // Saturation and lightness carry their %: "hsl(200, 50, 40)" is malformed.
  const s = /%$/.test(parts[1]) ? num(parts[1], 1) : null
  const l = /%$/.test(parts[2]) ? num(parts[2], 1) : null
  if (h === null || s === null || l === null || s < 0 || s > 100 || l < 0 || l > 100) return null
  return hslToRgb({ h: ((h % 360) + 360) % 360, s, l, a })
}

/* ---------- store and show ---------- */

/** THE ONE STORED FORM: lower-case `#rrggbb` when opaque, `#rrggbbaa`
 *  otherwise, alpha in 1/255 steps. Every value saved before alpha existed is
 *  already in it, and an opaque pick writes exactly what it always wrote. */
export function toStored(c: Rgba): string {
  const a = Math.round(clamp(c.a, 0, 1) * 255)
  return `#${byte(c.r)}${byte(c.g)}${byte(c.b)}${a === 255 ? '' : byte(a)}`
}

/** A STORED colour read back: the stored form of a 6 or 8 digit hex, or null
 *  for anything else (the choice goes back to the theme). The one reader both
 *  apps' colour settings use (audit 2026-10-12: two identical copies). */
export function canonicalStored(v: string | null | undefined): string | null {
  return v && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v) ? toStored(parseColour(v)!) : null
}

/** Alpha as text, at most two decimals, no trailing zeros. */
const alphaText = (a: number): string => String(Number(clamp(a, 0, 1).toFixed(2)))

/** How a field SHOWS a colour in the chosen format. Display only: RGBA and
 *  HSLA round, so "the same colour" is never judged on these strings. */
export function format(c: Rgba, f: ColourFormat): string {
  if (f === 'rgba') {
    const [r, g, b] = [c.r, c.g, c.b].map((n) => Math.round(clamp(n, 0, 255)))
    return `rgba(${r}, ${g}, ${b}, ${alphaText(c.a)})`
  }
  if (f === 'hsla') {
    const h = rgbToHsl(c)
    return `hsla(${Math.round(h.h) % 360}, ${Math.round(h.s)}%, ${Math.round(h.l)}%, ${alphaText(c.a)})`
  }
  return toStored(c)
}

/* ---------- conversions ---------- */

export function rgbToHsv(c: Rgba): Hsva {
  const r = c.r / 255
  const g = c.g / 255
  const b = c.b / 255
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
  }
  return { h: ((h * 60) % 360 + 360) % 360, s: max ? (d / max) * 100 : 0, v: max * 100, a: c.a }
}

export function hsvToRgb(c: Hsva): Rgba {
  const s = clamp(c.s, 0, 100) / 100
  const v = clamp(c.v, 0, 100) / 100
  const h = ((c.h % 360) + 360) % 360
  const f = (n: number): number => {
    const k = (n + h / 60) % 6
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255
  }
  return { r: f(5), g: f(3), b: f(1), a: c.a }
}

export function rgbToHsl(c: Rgba): Hsla {
  const r = c.r / 255
  const g = c.g / 255
  const b = c.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
  }
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0
  return { h: ((h * 60) % 360 + 360) % 360, s: s * 100, l: l * 100, a: c.a }
}

export function hslToRgb(c: Hsla): Rgba {
  const s = clamp(c.s, 0, 100) / 100
  const l = clamp(c.l, 0, 100) / 100
  const h = ((c.h % 360) + 360) % 360
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): number => {
    const k = (n + h / 30) % 12
    return (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255
  }
  return { r: f(0), g: f(8), b: f(4), a: c.a }
}

/* ---------- helpers on stored strings ---------- */

/** The two hex digits for an alpha, `round(a * 255)`. No clamp: that is the
 *  caller's. */
export function alphaHex(a: number): string {
  return Math.round(a * 255).toString(16).padStart(2, '0')
}

/** An alpha in whole percent, where only opaque reads 100 and only clear
 *  reads 0. The Selection's cap of 254/255 rounds to 100, and a screen reader
 *  told "100 percent opaque" of a selection xterm draws see-through is told
 *  wrong (#113 review). */
export function alphaPct(a: number): number {
  return a >= 1 ? 100 : a <= 0 ? 0 : clamp(Math.round(a * 100), 1, 99)
}

/** `#rrggbb` of any parseable colour, its alpha dropped; `fallback` else. */
export function opaque(c: string, fallback = '#000000'): string {
  const p = parseColour(c)
  return p ? toStored({ ...p, a: 1 }) : fallback
}

/** The alpha of any parseable colour, 1 for anything unparseable. */
export function alphaOf(c: string): number {
  return parseColour(c)?.a ?? 1
}

/** The colour at alpha `a`, stored form. */
export function withAlpha(c: string, a: number): string {
  const p = parseColour(c) ?? { r: 0, g: 0, b: 0, a: 1 }
  return toStored({ ...p, a: clamp(a, 0, 1) })
}

/* ---------- contrast on composites ---------- */

/** The opaque `#rrggbb` the eye gets when `c`, with its alpha, lies on the
 *  opaque `ground` (whose own alpha, if any, is ignored). */
export function composite(c: string, ground: string): string {
  const p = parseColour(c)
  const g = parseColour(ground) ?? { r: 0, g: 0, b: 0, a: 1 }
  if (!p) return toStored({ ...g, a: 1 })
  return toStored({
    r: g.r + (p.r - g.r) * p.a,
    g: g.g + (p.g - g.g) * p.a,
    b: g.b + (p.b - g.b) * p.a,
    a: 1
  })
}

/**
 * `colour` (opaque) walked towards white or black, whichever has room on
 * `ground`, the LEAST distance that reaches `floor`. A bisection rather than
 * `ensureContrast`'s 8% steps, so the result follows its input smoothly: a
 * colour's alpha moved one notch moves the result one notch, never a step.
 */
function towardsFloor(colour: string, ground: string, floor: number): string {
  if (contrastRatio(colour, ground) >= floor) return colour
  const to = towardRoom(ground)
  if (contrastRatio(to, ground) < floor) return to
  let lo = 0
  let hi = 1
  for (let i = 0; i < 20; i += 1) {
    const mid = (lo + hi) / 2
    if (contrastRatio(mixHex(colour, to, mid), ground) >= floor) hi = mid
    else lo = mid
  }
  return mixHex(colour, to, hi)
}

/**
 * A see-through colour that must stay legible, as the opaque colour it shows.
 * The floor is `min(floor, contrast of the opaque pick)`: alpha can never
 * make a colour less legible than the user's own opaque pick, the result is
 * continuous in alpha, and at alpha 1 nothing moves (a Custom foreground or
 * cursor has never been floored, and an update must not start doing it).
 */
export function legibleOn(c: string, ground: string, floor: number): string {
  const g = opaque(ground)
  const f = Math.min(floor, contrastRatio(opaque(c), g))
  return towardsFloor(composite(c, g), g, f)
}

/** The same with the plain floor, for what is floored even when opaque. */
export function legibleOnStrict(c: string, ground: string, floor: number): string {
  const g = opaque(ground)
  return towardsFloor(composite(c, g), g, floor)
}

/**
 * Black or white text for a fill, chosen on what the eye sees. An OPAQUE fill
 * keeps the tab strip's own rule, byte for byte: text biases WHITE (white on
 * the default orange is the look), black only on genuinely light fills
 * (contrast against black of 12). A SEE-THROUGH fill takes whichever of the
 * two reads better on the composite over `ground`, never under 4.5:1: over a
 * light strip a half tint is a light fill and white on it fails (Prism #254,
 * MEASURED 1.8:1 to 2.1:1). A ground that does not parse: the tint is solid.
 */
export function inkOn(tint: string, ground: string): string {
  const t = parseColour(tint)
  if (t && t.a < 1 && parseColour(ground)) {
    const fill = composite(tint, ground)
    return contrastRatio('#000000', fill) >= contrastRatio('#ffffff', fill) ? '#000000' : '#ffffff'
  }
  const fill = t ? toStored({ ...t, a: 1 }) : tint
  return contrastRatio('#000000', fill) < 12 ? '#ffffff' : '#000000'
}

/**
 * The text-bearing version of a see-through fill (moved here from Prism #251,
 * since both apps would otherwise each write it). The ink is chosen on the
 * fill AS SEEN over every ground it may sit on, and the fill (opaque here; the
 * caller lays its alpha back on) is nudged until that ink clears 4.5:1 on the
 * worst of them. If the leaning ink cannot get there the other is tried, and
 * if neither can, the pair whose worst ground reads best is kept.
 */
export function selectionFor(fill: string, grounds: string[]): { fill: string; ink: string } {
  const p = parseColour(fill) ?? { r: 0, g: 0, b: 0, a: 1 }
  const a = p.a
  const solid = toStored({ ...p, a: 1 })
  const gs = grounds.length ? grounds.map((g) => opaque(g)) : [solid]
  const seen = (c: string): string[] => gs.map((g) => composite(withAlpha(c, a), g))
  const worst = (c: string, ink: string): number => Math.min(...seen(c).map((s) => contrastRatio(ink, s)))
  const first = seen(solid)[0]
  const leaning = contrastRatio('#ffffff', first) >= contrastRatio('#0b0d12', first) ? '#ffffff' : '#0b0d12'
  let best = { fill: solid, ink: leaning, score: -1 }
  for (const ink of [leaning, leaning === '#ffffff' ? '#0b0d12' : '#ffffff']) {
    const towards = ink === '#ffffff' ? '#000000' : '#ffffff'
    for (let i = 0; i <= 25; i += 1) {
      const c = mixHex(solid, towards, i * 0.04)
      const score = worst(c, ink)
      if (score >= 4.5) return { fill: c, ink }
      if (score > best.score) best = { fill: c, ink, score }
    }
  }
  return { fill: best.fill, ink: best.ink }
}

/* ---------- the field's commit rule ---------- */

export interface AlphaRange {
  /** false: the colour has no alpha; a typed one is dropped. Default true. */
  alpha?: boolean
  alphaMin?: number
  alphaMax?: number
}

/** A colour held to a field's alpha rules: opaque where it has none, else the
 *  alpha clamped to its range. */
export function fitAlpha(c: Rgba, { alpha = true, alphaMin = 0, alphaMax = 1 }: AlphaRange = {}): Rgba {
  return { ...c, a: alpha ? clamp(c.a, alphaMin, alphaMax) : 1 }
}

const squash = (s: string): string => s.toLowerCase().replace(/\s+/g, '')

/**
 * What a code field's blur or Enter commits (generalising the old hex rule, #26
 * and #71): only a DRAFT the user typed that parses AND names another colour,
 * alpha included, in the stored form. "Another colour" is judged on
 * `toStored` of both, never the strings; and a draft that reads exactly as the
 * field showed the value, in any format, is no change, since RGBA and HSLA are
 * rounded for display. Tabbing through a row that follows the theme pins
 * nothing.
 */
export function colourCommit(draft: string | null, value: string, range: AlphaRange = {}): string | null {
  if (draft === null) return null
  const typed = parseColour(draft)
  if (!typed) return null
  const was = parseColour(value)
  if (was) {
    const shown = fitAlpha(was, range)
    const d = squash(draft)
    if ((['hex', 'rgba', 'hsla'] as const).some((f) => squash(format(shown, f)) === d)) return null
  }
  // A code that names NO alpha (#rgb, #rrggbb, rgb(), hsl()) changes the
  // colour and keeps the alpha in force (owner, 2026-10-03: a 6-digit code
  // typed into a see-through Primary turned the window solid). An alpha is
  // changed by the bar or by a code that says one.
  const own = was && !saysAlpha(draft) ? { ...typed, a: was.a } : typed
  const next = toStored(fitAlpha(own, range))
  return was && next === toStored(fitAlpha(was, range)) ? null : next
}

/** Whether a typed code carries an alpha of its own: `#rgba`, `#rrggbbaa`, or
 *  a fourth argument to rgb()/hsl(). */
export function saysAlpha(text: string): boolean {
  const v = text.trim().toLowerCase()
  const hex = /^#?([0-9a-f]+)$/.exec(v)
  if (hex) return hex[1].length === 4 || hex[1].length === 8
  const fn = /^(rgba?|hsla?)\((.*)\)$/.exec(v)
  return !!fn && (args(fn[2])?.length ?? 0) === 4
}

/**
 * Where the alpha bar lands for a pointer or key value `a` when the host has
 * steps of its own (Prism's glass levels). The SNAPPED alpha is what is drawn
 * and announced (#251 review: the bar said 99, 98, 97, 96 while 95 was
 * stored), and a KEY press that would land on the step already held walks on
 * to the next distinct one, so no press is dead. A drag simply snaps.
 */
export function snapAlphaStep(
  a: number,
  held: number,
  key: boolean,
  { min = 0, max = 1, snap }: { min?: number; max?: number; snap?: (a: number) => number } = {}
): number {
  const fit = (n: number): number => Math.min(max, Math.max(min, n))
  const want = fit(a)
  if (!snap) return want
  const at = snap(want)
  const was = snap(held)
  if (!key || at !== was || Math.abs(want - held) > 0.011) return at
  const dir = want > held ? 1 : -1
  for (let p = Math.round(want * 100) + dir; p >= Math.round(min * 100) && p <= Math.round(max * 100); p += dir) {
    const next = snap(fit(p / 100))
    if (next !== was) return next
  }
  return was
}
