import { describe, expect, it } from 'vitest'
import { LUCIDE, LUCIDE_VERSION } from './folderIconSet'
import { buildFolderIconSet, PRISM_ICONS } from './folderIconSetLoad'

const TOKEN = /[MmLlHhVvCcSsQqTtAaZz]|[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|[\s,]+/gy

/** True when `d` is nothing but path commands, numbers and separators, and
 *  starts with an absolute moveto (so it can follow another part). */
function parses(d: string): boolean {
  if (!/^M/.test(d)) return false
  TOKEN.lastIndex = 0
  let at = 0
  while (at < d.length) {
    TOKEN.lastIndex = at
    const m = TOKEN.exec(d)
    if (!m || m.index !== at || !m[0].length) return false
    at += m[0].length
  }
  return true
}

// The icons Lucide draws with filled dots (spec, counted 2026-10-31).
const FILLED = [
  'brain-circuit',
  'chart-quadrant',
  'chart-scatter',
  'galaxy',
  'images',
  'key-round',
  'palette',
  'tag',
  'tag-plus',
  'tag-x',
  'tags',
  'vault'
]

describe('the built-in folder icon set', () => {
  const set = buildFolderIconSet(LUCIDE)

  it('is every Lucide icon, well over the 300 asked for', () => {
    expect(LUCIDE_VERSION).toBe('1.66.0')
    expect(LUCIDE.length).toBe(2015)
    expect(set.icons.length).toBe(2015 + PRISM_ICONS.length)
  })

  it("Prism's own nine glyphs come first", () => {
    expect(set.icons.slice(0, 9).map((i) => i.name)).toEqual([
      'prism-home',
      'prism-desktop',
      'prism-downloads',
      'prism-documents',
      'prism-pictures',
      'prism-music',
      'prism-videos',
      'prism-drive',
      'prism-usb'
    ])
  })

  it('names are unique, short and plain, and every icon has tags (at most 8)', () => {
    expect(set.byName.size).toBe(set.icons.length)
    for (const icon of set.icons) {
      expect(icon.name, icon.name).toMatch(/^[a-z0-9-]{1,64}$/)
      expect(icon.tags.length, icon.name).toBeGreaterThan(0)
      expect(icon.tags.length, icon.name).toBeLessThanOrEqual(8)
    }
  })

  it('every path parses', () => {
    const bad = set.icons.filter((i) => !parses(i.d) || (i.fill !== undefined && !parses(i.fill))).map((i) => i.name)
    expect(bad).toEqual([])
  })

  it('the icons with filled dots keep them, and only they have any', () => {
    const filled = set.icons.filter((i) => i.fill).map((i) => i.name)
    expect(filled.sort()).toEqual([...FILLED].sort())
  })

  it('camera has its tags for the search', () => {
    expect(set.byName.get('camera')?.tags).toContain('photography')
  })
})
