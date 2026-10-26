// Small, pure colour maths, self-contained on purpose: the hex reader, the mix,
// WCAG luminance and contrast, and the one direction rule a floor walk takes.
// Moved out of termAnsi.ts (2026-10-26, explorer-only strip) so colour.ts and
// oklab.ts, which the settings picker and the themes keep, no longer depend on
// the terminal's palette module. termAnsi re-exports these unchanged.

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

export function luminance(hex: string): number {
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

/**
 * WHICH WAY A COLOUR WALKS TO CLEAR A FLOOR ON `ground`: toward whichever of
 * white and black has more room. A luminance threshold gets mid-lightness
 * grounds wrong: on a lavender, "lighter" runs out of contrast before the
 * floor, while black has plenty. The one direction rule every floor walk in
 * both apps takes (audit 2026-10-12: typed three times); HOW each walks (steps,
 * bisection, OKLab, several grounds) stays its own, each measured.
 */
export function towardRoom(ground: string): '#ffffff' | '#000000' {
  return contrastRatio('#ffffff', ground) >= contrastRatio('#000000', ground) ? '#ffffff' : '#000000'
}
