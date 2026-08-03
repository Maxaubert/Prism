import { describe, expect, it } from 'vitest'
import { derive, mix, STYLES } from './theme'

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

  it('keeps file names close to the text colour', () => {
    // The floor is a limit, not a target: sitting on 7:1 is what made light
    // styles look washed out. 1.55 rather than 1.5 since the tiers are measured
    // against the window's one surface - on a light style that surface is the
    // paper white rather than the slightly darker panel it used to be, so
    // clearing the same floor lands a hair further from the text.
    expect(contrast(t['--p-text-soft'], t['--p-text'])).toBeLessThan(1.55)
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

  it('gives the little previews a stage that reads', () => {
    // Schematics are drawn in the accent's own colours, so the box behind them
    // has to differ from the card, in either mode.
    expect(contrast(t['--p-preview'], t['--p-bg'])).toBeGreaterThan(1.08)
    expect(contrast(t['--p-accent-hi'], t['--p-preview'])).toBeGreaterThanOrEqual(2.9)
  })

  it('keeps the schematic stage clear of the card it sits in', () => {
    // The card is a ~6% wash of the text colour over the page; on a light style
    // that put a white-ish stage on a white-ish card, and the schematic vanished.
    const card = mix(t['--p-bg'], style.text, style.mode === 'light' ? 0.07 : 0.06)
    expect(contrast(t['--p-preview'], card)).toBeGreaterThan(1.1)
  })

  it('draws inert tracks so they read on that stage', () => {
    // The unfilled half of a progress bar. Not text, so it needn't hit 4.5, but
    // it has to be plainly there.
    expect(contrast(t['--p-track'], t['--p-preview'])).toBeGreaterThan(1.6)
  })

  it('paints the panel and the viewer as one surface', () => {
    // The chrome separates itself with edges and material, never with a step in
    // shade: a step reads as a mismatched pane on glass, and reappears the
    // moment the glass is turned off.
    expect(t['--p-side-flat']).toBe(t['--p-bg'])
  })
})
