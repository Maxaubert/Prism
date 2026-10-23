import { describe, expect, it } from 'vitest'
import { CLAWD_PIXELS, iconKind } from './agentIcon'

describe('the mark a tab wears (owner, 2026-10-12)', () => {
  it('is the agent in its shell, the prompt for any other, the cog for Settings', () => {
    expect(iconKind('claude')).toBe('claude')
    expect(iconKind('codex')).toBe('codex')
    expect(iconKind('other')).toBe('shell')
    expect(iconKind(null)).toBe('shell')
    expect(iconKind('claude', true)).toBe('settings')
  })
})

describe('Clawd', () => {
  it("is Claude Code's own start-screen block art, a quadrant a pixel", () => {
    // Each block character is a 2 x 2 cell of quadrants: TL, TR, BL, BR.
    const Q: Record<string, [number, number, number, number]> = {
      ' ': [0, 0, 0, 0], '█': [1, 1, 1, 1], '▐': [0, 1, 0, 1], '▌': [1, 0, 1, 0],
      '▛': [1, 1, 1, 0], '▜': [1, 1, 0, 1], '▝': [0, 1, 0, 0], '▘': [1, 0, 0, 0]
    }
    const art = [' ▐▛███▜▌', '▝▜█████▛▘', '  ▘▘ ▝▝']
    const want = new Set<string>()
    art.forEach((line, row) =>
      [...line].forEach((ch, col) => {
        const [tl, tr, bl, br] = Q[ch]
        if (tl) want.add(`${col * 2},${row * 2}`)
        if (tr) want.add(`${col * 2 + 1},${row * 2}`)
        if (bl) want.add(`${col * 2},${row * 2 + 1}`)
        if (br) want.add(`${col * 2 + 1},${row * 2 + 1}`)
      })
    )
    const got = new Set(CLAWD_PIXELS.map(([x, y]) => `${x},${y}`))
    expect([...got].sort()).toEqual([...want].sort())
    expect(CLAWD_PIXELS.length).toBe(got.size)
  })
})
