// THE ACCENT CAN BE SEE-THROUGH (#249; owner, 2026-10-02: "in prism the accent
// colour should be able to have an alpha value", and of the ways offered, FILLS
// ONLY). The alpha reaches the accent's fills (the selection, buttons, chips);
// every colour sum in theme.ts still works on opaque hex, so anything derived
// from the accent is handed the colour as SEEN, composited over its ground,
// never a string with an alpha it would misparse. Pure, so it is tested.

/** The slider's range. Below a tenth a fill stops reading as one. */
export const ALPHA_MIN = 0.1
export const ALPHA_MAX = 1

/**
 * A stored opacity, made safe: missing, not a number, or anything a hand-edited
 * profile might hold reads as fully solid, and the rest is held to the range.
 * A style saved before #249 has none, so it reads as 1 and looks as it did.
 */
export function accentAlphaOf(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 1
  return Math.min(ALPHA_MAX, Math.max(ALPHA_MIN, raw))
}

/**
 * What the hex field accepts: #rgb, #rgba, #rrggbb and #rrggbbaa, with or
 * without the hash. The colour comes back as #rrggbb (the native picker and
 * every sum here take six digits) and the alpha separately, null when the
 * input carried none. Anything else is null.
 */
export function parseHexAlpha(raw: string): { hex: string; alpha: number | null } | null {
  const s = raw.trim().replace(/^#/, '').toLowerCase()
  if (!/^[0-9a-f]+$/.test(s)) return null
  let full: string
  if (s.length === 3 || s.length === 4) full = s.split('').map((c) => c + c).join('')
  else if (s.length === 6 || s.length === 8) full = s
  else return null
  const hex = '#' + full.slice(0, 6)
  const alpha = full.length === 8 ? parseInt(full.slice(6), 16) / 255 : null
  return { hex, alpha }
}

/** The two hex digits for an alpha, for showing an opacity in the hex field. */
export const alphaHex = (a: number): string =>
  Math.round(accentAlphaOf(a) * 255)
    .toString(16)
    .padStart(2, '0')

const rgbOf = (h: string): number[] => {
  const s = h.replace('#', '')
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s.slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** `colour` at `alpha` laid over the opaque `ground`: what the eye gets. */
export function composite(colour: string, alpha: number, ground: string): string {
  const a = accentAlphaOf(alpha)
  const C = rgbOf(colour)
  const G = rgbOf(ground)
  return '#' + C.map((v, i) => Math.round(G[i] + (v - G[i]) * a).toString(16).padStart(2, '0')).join('')
}

/** A fill token for `colour` at `alpha`: the plain hex when solid, so a style
 *  at 100% publishes exactly the value it always did. */
export function fillOf(colour: string, alpha: number): string {
  const a = accentAlphaOf(alpha)
  if (a >= 1) return colour
  const [r, g, b] = rgbOf(colour)
  return `rgba(${r},${g},${b},${Number(a.toFixed(3))})`
}
