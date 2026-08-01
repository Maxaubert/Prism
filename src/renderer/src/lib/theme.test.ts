import { describe, expect, it } from 'vitest'
import { derive, STYLES } from './theme'

// Every shipped style has to be readable, in both modes. These are the numbers
// that caught grey-on-white: a fixed dimming fraction reads fine on a dark panel
// and washes out on a light one.

const hex2rgb = (h: string): number[] => {
  const s = h.replace('#', '')
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
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

describe.each(STYLES.map((s) => [s.name, s] as const))('%s', (_name, style) => {
  const t = derive(style)

  it('has body text well clear of its panel', () => {
    expect(contrast(t['--p-text'], t['--p-side-flat'])).toBeGreaterThanOrEqual(7)
    expect(contrast(t['--p-text'], t['--p-bg'])).toBeGreaterThanOrEqual(7)
  })

  it('keeps every dimmed tier legible', () => {
    // The tree's file names, then labels, then the quietest hints.
    expect(contrast(t['--p-text-soft'], t['--p-side-flat'])).toBeGreaterThanOrEqual(6.9)
    expect(contrast(t['--p-dim'], t['--p-side-flat'])).toBeGreaterThanOrEqual(4.4)
    expect(contrast(t['--p-dim2'], t['--p-side-flat'])).toBeGreaterThanOrEqual(3.1)
  })

  it('dims rather than brightens', () => {
    // Each tier should sit between the text and the panel, never past it.
    const order = [t['--p-text'], t['--p-text-soft'], t['--p-dim'], t['--p-dim2']]
      .map((c) => contrast(c, t['--p-side-flat']))
    expect(order[0]).toBeGreaterThanOrEqual(order[1])
    expect(order[1]).toBeGreaterThanOrEqual(order[2])
    expect(order[2]).toBeGreaterThanOrEqual(order[3])
  })

  it('labels the selected row against the accent', () => {
    expect(contrast(t['--p-on-accent'], t['--p-sel-bg'])).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the selection recognisably the accent', () => {
    // Nudged for contrast, not repainted: it still has to read as the accent.
    expect(contrast(t['--p-sel-bg'], t['--p-accent'])).toBeLessThan(2)
  })

  it('keeps the kind tints visible on the panel', () => {
    for (const kind of ['image', 'video', 'audio', 'pdf', 'text', 'folder']) {
      const tint = t['--p-kind-' + kind]
      expect(contrast(tint, t['--p-side-flat'])).toBeGreaterThanOrEqual(2.6)
    }
  })

  it('separates the panel from the viewer', () => {
    // Not a rule, a sanity check: the two surfaces shouldn't be identical
    // unless the style means it (true black).
    if (style.material !== 'oled') expect(t['--p-bg']).not.toBe(t['--p-side-flat'])
  })
})
