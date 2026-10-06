import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { opaque } from 'prism-term-core/renderer/lib/colour'
import { LEGACY_CODE, STYLES, variablesFor } from './theme'
import { RETIRED_STYLES } from './themes/retired'

// The syntax palette is hand-picked, and hand-picked colour is exactly the kind
// that rots quietly: it shipped once with every token between 1.6:1 and 2.7:1
// on the five light styles, which is unreadable, and nothing complained. Since
// #298 the colours are the THEME's, published as tokens by `variablesFor`, so
// this reads the tokens each style paints, not a stylesheet. AA body text is
// 4.5:1; code is body text.
const AA = 4.5

const channel = (c: number): number => {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const luminance = (hex: string): number => {
  const n = Number.parseInt(hex.slice(1, 7), 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Every `--p-code-*` the highlighter and the editor read, from their source. */
const used = [
  ...new Set(
    [...readFileSync('src/renderer/src/lib/codeTheme.ts', 'utf8').matchAll(/var\(--p-code-([a-z-]+)\)/g)].map((m) => m[1])
  )
]

/** The colours a reader sees as text (not the fills behind it). */
const TEXT = ['keyword', 'string', 'number', 'comment', 'fn', 'type', 'const', 'op', 'meta', 'tag', 'attr', 'invalid']

describe('the code colours are tokens of every style', () => {
  it('the highlighter reads the tag and attribute tokens of its own', () => {
    expect(used).toContain('tag')
    expect(used).toContain('attr')
  })

  for (const s of [...STYLES, ...RETIRED_STYLES]) {
    it(`${s.id} publishes every token the highlighter uses`, () => {
      const v = variablesFor(s)
      for (const t of used) expect(v[`--p-code-${t}`], `${s.id} ${t}`).toBeTruthy()
    })
  }
})

describe("each theme's code clears AA where it is painted", () => {
  for (const s of STYLES) {
    it(`${s.name} (${s.mode}): on the ground and the panel`, () => {
      const v = variablesFor(s)
      const grounds = [opaque(s.bg), v['--p-side-flat']]
      const failures = TEXT.flatMap((t) =>
        grounds
          .map((g) => ({ t, g, ratio: +contrast(v[`--p-code-${t}`], g).toFixed(2) }))
          .filter((x) => x.ratio < AA)
      )
      expect(failures, `${s.name}: ${JSON.stringify(failures)}`).toEqual([])
    })
  }
})

describe('the legacy sets an own copy saved before #298 keeps', () => {
  // Orchid painted a tinted background darker than its `bg` literal, so the
  // test uses a margin rather than the literal: a style may tint what it sits on.
  const TINT_MARGIN = 0.96
  const shade = (hex: string, k: number): string => {
    const n = Number.parseInt(hex.slice(1), 16)
    const f = (c: number): string =>
      Math.round(Math.min(255, c * k))
        .toString(16)
        .padStart(2, '0')
    return `#${f((n >> 16) & 255)}${f((n >> 8) & 255)}${f(n & 255)}`
  }

  it('define the same tokens in both modes', () => {
    expect(Object.keys(LEGACY_CODE.light).sort()).toEqual(Object.keys(LEGACY_CODE.dark).sort())
  })

  for (const style of RETIRED_STYLES) {
    const set = LEGACY_CODE[style.mode]
    const bg = style.mode === 'light' ? shade(style.bg, TINT_MARGIN) : style.bg
    it(`clear AA on ${style.name} (${style.mode}), and are what it paints`, () => {
      const hex = Object.entries(set).filter(([, v]) => v.startsWith('#'))
      const failures = hex
        .map(([token, c]) => ({ token, c, ratio: +contrast(c, bg).toFixed(2) }))
        .filter((t) => t.ratio < AA)
      expect(failures, `${style.name}: ${JSON.stringify(failures)}`).toEqual([])
      const v = variablesFor(style)
      for (const [token, c] of Object.entries(set)) expect(v[`--p-code-${token}`], token).toBe(c)
      // Tags were keywords and attribute names the soft text before the tokens.
      expect(v['--p-code-tag']).toBe(set.keyword)
      expect(v['--p-code-attr']).toBe(v['--p-text-soft'])
    })
  }

  // On dark there is room for comments to be the dimmest thing on screen. On
  // light there is not: no grey is both dimmer than the dimmest code token and
  // still AA against Orchid's tint. So light only promises that comments never
  // shout.
  it('keep comments quiet: dimmest of all on dark, never the loudest on light', () => {
    const CODE = ['keyword', 'string', 'number', 'fn', 'type', 'const'] as const
    const onBlack = (hex: string): number => contrast(hex, '#000000')
    const darkCode = CODE.map((t) => onBlack(LEGACY_CODE.dark[t]))
    expect(onBlack(LEGACY_CODE.dark.comment)).toBeLessThan(Math.min(...darkCode))
    const onWhite = (hex: string): number => contrast(hex, '#ffffff')
    const lightCode = CODE.map((t) => onWhite(LEGACY_CODE.light[t]))
    expect(onWhite(LEGACY_CODE.light.comment)).toBeLessThan(Math.max(...lightCode))
  })
})
