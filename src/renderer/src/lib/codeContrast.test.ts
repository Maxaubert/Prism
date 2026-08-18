import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { STYLES } from './theme'

// The syntax palette is hand-picked, and hand-picked colour is exactly the kind
// that rots quietly: it shipped once with every token between 1.6:1 and 2.7:1
// on the five light styles, which is unreadable, and nothing complained. This
// reads the real CSS and checks it against the real styles so that cannot
// happen again. AA body text is 4.5:1; code is body text.
const AA = 4.5

const css = readFileSync('src/renderer/src/index.css', 'utf8')

/** The `--p-code-*` values from one CSS rule, keyed by token name. */
function palette(selector: RegExp): Record<string, string> {
  const block = selector.exec(css)
  if (!block) throw new Error(`no rule matched ${String(selector)}`)
  const out: Record<string, string> = {}
  for (const m of block[1].matchAll(/--p-code-([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2]
  return out
}

const channel = (c: number): number => {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const luminance = (hex: string): number => {
  const n = Number.parseInt(hex.slice(1), 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// The dark set lives on a bare :root - but index.css has more than one, so
// this anchors on the rule that actually declares the tokens, not the first.
const DARK = palette(/:root\s*\{([^{}]*--p-code-keyword[^{}]*)\}/)
const LIGHT = palette(/:root\[data-mode='light'\]\s*\{([\s\S]*?)\n\}/)

// Orchid paints a tinted background darker than its `bg` literal, so the test
// uses a margin rather than the literal: a style may tint what it sits on.
const TINT_MARGIN = 0.96

describe('the syntax palette', () => {
  it('defines the same tokens in both modes', () => {
    expect(Object.keys(LIGHT).sort()).toEqual(Object.keys(DARK).sort())
  })

  it('covers every token the highlighter uses', () => {
    for (const t of ['keyword', 'string', 'number', 'comment', 'fn', 'type', 'const', 'op', 'meta', 'invalid'])
      expect(Object.keys(DARK), t).toContain(t)
  })

  const shade = (hex: string, k: number): string => {
    const n = Number.parseInt(hex.slice(1), 16)
    const f = (c: number): string =>
      Math.round(Math.min(255, c * k))
        .toString(16)
        .padStart(2, '0')
    return `#${f((n >> 16) & 255)}${f((n >> 8) & 255)}${f(n & 255)}`
  }

  for (const style of STYLES) {
    const set = style.mode === 'light' ? LIGHT : DARK
    // Only the background matters here: the editor paints over --p-bg.
    const bg = style.mode === 'light' ? shade(style.bg, TINT_MARGIN) : style.bg

    it(`clears AA on ${style.name} (${style.mode})`, () => {
      const failures = Object.entries(set)
        .map(([token, hex]) => ({ token, hex, ratio: +contrast(hex, bg).toFixed(2) }))
        .filter((t) => t.ratio < AA)
      expect(failures, `${style.name}: ${JSON.stringify(failures)}`).toEqual([])
    })
  }

  // On dark there is room for comments to be the dimmest thing on screen. On
  // light there is not: no grey is both dimmer than the dimmest code token and
  // still AA against Orchid, which tints its background darker than its own
  // `bg` literal. Legibility is the requirement and "quietest" is the
  // preference, so light only promises that comments never shout.
  it('keeps comments quiet: dimmest of all on dark, never the loudest on light', () => {
    const CODE = ['keyword', 'string', 'number', 'fn', 'type', 'const'] as const

    const onBlack = (hex: string): number => contrast(hex, '#000000')
    const darkCode = CODE.map((t) => onBlack(DARK[t]))
    expect(onBlack(DARK.comment), 'dark comment should be the dimmest token')
      .toBeLessThan(Math.min(...darkCode))

    const onWhite = (hex: string): number => contrast(hex, '#ffffff')
    const lightCode = CODE.map((t) => onWhite(LIGHT[t]))
    expect(onWhite(LIGHT.comment), 'light comment should not be the loudest token')
      .toBeLessThan(Math.max(...lightCode))
  })
})
