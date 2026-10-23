import { describe, expect, it } from 'vitest'
import { TERM_PRESETS } from './termTheme'
import { NEUTRAL_CHROMA, oklch, orderTermThemes } from './themeOrder'

const NEUTRALS = [
  'pitch', 'volt', 'prism', 'campbell', 'pt-default',
  'graphite', 'monokai', 'gruvbox-dark', 'mist', 'catppuccin-latte', 'paper'
]

describe('oklch', () => {
  it('measures black, white and a grey as achromatic, black to white', () => {
    expect(oklch('#000000').L).toBeCloseTo(0, 3)
    expect(oklch('#ffffff').L).toBeCloseTo(1, 3)
    expect(oklch('#808080').C).toBeLessThan(1e-4)
    expect(oklch('#ff0000').C).toBeGreaterThan(0.2)
  })
})

describe('orderTermThemes (#157)', () => {
  const ordered = orderTermThemes(TERM_PRESETS)
  const neutral = (bg: string): boolean => oklch(bg).C < NEUTRAL_CHROMA

  it('is a permutation of the input and leaves the input alone', () => {
    expect(ordered).toHaveLength(TERM_PRESETS.length)
    expect(new Set(ordered)).toEqual(new Set(TERM_PRESETS))
    expect(orderTermThemes(TERM_PRESETS).map((p) => p.id)).toEqual(ordered.map((p) => p.id))
  })

  it('puts every neutral theme before every coloured one', () => {
    const firstColoured = ordered.findIndex((p) => !neutral(p.bg))
    expect(ordered.slice(firstColoured).every((p) => !neutral(p.bg))).toBe(true)
  })

  it('runs black to white inside each group', () => {
    for (const group of [ordered.filter((p) => neutral(p.bg)), ordered.filter((p) => !neutral(p.bg))]) {
      for (let i = 1; i < group.length; i++) expect(oklch(group[i].bg).L).toBeGreaterThanOrEqual(oklch(group[i - 1].bg).L)
    }
  })

  it('measures the eleven neutral grounds', () => {
    expect(ordered.filter((p) => neutral(p.bg)).map((p) => p.id).sort()).toEqual([...NEUTRALS].sort())
  })

  it('has no preset ground on the fence, so a new theme cannot land there unnoticed', () => {
    for (const p of TERM_PRESETS) expect(Math.abs(oklch(p.bg).C - NEUTRAL_CHROMA), p.id).toBeGreaterThan(0.001)
  })

  // No two presets share a ground since High Contrast left (owner, 2026-10-11),
  // so the tie is a made-up pair: a new preset on an existing ground keeps its place.
  it('keeps the list order on a tie', () => {
    const a = { id: 'a', bg: '#101010' }
    const b = { id: 'b', bg: '#101010' }
    expect(orderTermThemes([b, a]).map((p) => p.id)).toEqual(['b', 'a'])
  })

  it('holds the whole order', () => {
    expect(ordered.map((p) => p.id)).toMatchSnapshot()
  })
})
