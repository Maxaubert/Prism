import { describe, expect, it } from 'vitest'
import { ANSI_CONTRAST_FLOOR, contrastRatio, deriveAnsi, ensureContrast, normalizeColor } from './termAnsi'

const HUES = [
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightBlack',
  'white',
  'brightWhite'
] as const

describe('the user-reported case: a red background', () => {
  it('red text on a red background clears the floor instead of vanishing', () => {
    const a = deriveAnsi('#7a1111', '#f5e9e9')
    expect(contrastRatio(a.red, '#7a1111')).toBeGreaterThanOrEqual(ANSI_CONTRAST_FLOOR)
    expect(contrastRatio(a.brightRed, '#7a1111')).toBeGreaterThanOrEqual(ANSI_CONTRAST_FLOOR)
  })
})

describe('contrast guarantees, everywhere', () => {
  const cases = [
    ['pure black', '#000000', '#e6e6e6'],
    ['pure white', '#ffffff', '#1a1a1a'],
    ['deep blue', '#0d1b3a', '#dbe4f5'],
    ['forest', '#0d2416', '#dcecdf'],
    ['hot pink', '#c2186f', '#ffe9f4'],
    ['mid grey', '#808080', '#101010'],
    ['warm light', '#f6f0e4', '#2a241c']
  ] as const
  for (const [name, bg, fg] of cases) {
    it(`every hue reads on ${name}`, () => {
      const a = deriveAnsi(bg, fg)
      for (const h of HUES) {
        expect(contrastRatio(a[h], bg), h).toBeGreaterThanOrEqual(ANSI_CONTRAST_FLOOR - 0.01)
      }
    })
  }

  it('holds over a sweep of arbitrary backgrounds (property check)', () => {
    // Deterministic pseudo-random: the point is coverage, not novelty per run.
    let seed = 42
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    const hex = (): string =>
      '#' +
      [0, 0, 0]
        .map(() => Math.floor(rnd() * 256).toString(16).padStart(2, '0'))
        .join('')
    for (let i = 0; i < 200; i += 1) {
      const bg = hex()
      const fg = ensureContrast('#c8c8c8', bg, 4.5)
      const a = deriveAnsi(bg, fg)
      for (const h of HUES) {
        expect(contrastRatio(a[h], bg), `${h} on ${bg}`).toBeGreaterThanOrEqual(
          ANSI_CONTRAST_FLOOR - 0.01
        )
      }
    }
  })
})

describe('hue identity survives adaptation', () => {
  it('on plain dark, the seeds pass through nearly untouched', () => {
    const a = deriveAnsi('#101215', '#e3e6ea')
    expect(a.red).toBe('#e05561') // already readable: no bleaching
    expect(a.blue).toBe('#4aa5f0')
  })
  it('on a light background the hues darken rather than invert', () => {
    const a = deriveAnsi('#ffffff', '#1a1a1a')
    // still recognisably red: the red channel dominates
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(a.red.slice(i, i + 2), 16))
    expect(r).toBeGreaterThan(g)
    expect(r).toBeGreaterThan(b)
  })
})

describe('normalizeColor: every shape a style can publish', () => {
  it('passes hex through, expands #rgb, drops #rrggbbaa alpha', () => {
    expect(normalizeColor('#101215', '#000000')).toBe('#101215')
    expect(normalizeColor('#abc', '#000000')).toBe('#aabbcc')
    expect(normalizeColor('#10121580', '#000000')).toBe('#101215')
  })
  it('flattens rgb() and rgba() - the acrylic case', () => {
    expect(normalizeColor('rgba(16, 18, 21, 0.6575)', '#000000')).toBe('#101215')
    expect(normalizeColor('rgb(255,0,0)', '#000000')).toBe('#ff0000')
  })
  it('unparseable input takes the fallback, never NaN maths', () => {
    expect(normalizeColor('transparent', '#101215')).toBe('#101215')
    expect(normalizeColor('', '#101215')).toBe('#101215')
  })
})

describe('the acrylic regression: rgba background must not blacken the palette', () => {
  it('derives readable hues against the flattened surface', () => {
    const a = deriveAnsi('rgba(16, 18, 21, 0.6575)', '#e8eaf0')
    expect(a.red).not.toBe('#000000')
    expect(a.green).not.toBe('#000000')
    for (const h of ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan'] as const) {
      expect(contrastRatio(a[h], '#101215'), h).toBeGreaterThanOrEqual(ANSI_CONTRAST_FLOOR - 0.01)
    }
  })
})
