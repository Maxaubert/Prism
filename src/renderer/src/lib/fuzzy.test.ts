import { describe, expect, it } from 'vitest'
import { fold, fuzzyFilter, fuzzyScore, haystack, queryWords, wordScore } from './fuzzy'
import { LUCIDE } from './folderIconSet'
import { buildFolderIconSet } from './folderIconSetLoad'

const h = (name: string, tags: string[] = []) => haystack(name, tags)
const names = (hay: ReturnType<typeof haystack>[], q: string): string[] =>
  fuzzyFilter(hay, q).map((i) => hay[i].name)

describe('fuzzy', () => {
  it('folds case and accents', () => {
    expect(fold('Café ÉTÉ')).toBe('cafe ete')
    expect(queryWords('  Fôlder-Open ')).toEqual(['folder', 'open'])
  })

  it('whole name beats a name prefix beats a name word beats a tag beats letters in order', () => {
    const exact = wordScore(h('camera'), 'camera')
    const prefix = wordScore(h('camera-off'), 'camera')
    const word = wordScore(h('video-camera'), 'camera')
    const tag = wordScore(h('aperture', ['camera']), 'camera')
    const tagPrefix = wordScore(h('aperture', ['cameras']), 'camera')
    const letters = wordScore(h('cxaxmxexrxa'), 'camera')
    expect(exact).toBeGreaterThan(prefix)
    expect(prefix).toBeGreaterThan(word)
    expect(word).toBeGreaterThan(tag)
    expect(tag).toBeGreaterThan(tagPrefix)
    expect(tagPrefix).toBeGreaterThan(letters)
    expect(letters).toBeGreaterThan(0)
  })

  it('every word must match', () => {
    expect(fuzzyScore(h('folder-open'), queryWords('folder open'))).toBeGreaterThan(0)
    expect(fuzzyScore(h('folder-open'), queryWords('folder zebra'))).toBe(0)
  })

  it('ties sort by name, and an empty query keeps the set order', () => {
    const hay = [h('b-thing', ['x']), h('a-thing', ['x']), h('c')]
    expect(names(hay, 'x')).toEqual(['a-thing', 'b-thing'])
    expect(names(hay, '')).toEqual(['b-thing', 'a-thing', 'c'])
  })

  describe('over the whole built-in set', () => {
    const set = buildFolderIconSet(LUCIDE)
    const top = (q: string, n = 1): string[] => fuzzyFilter(set.hay, q).slice(0, n).map((i) => set.icons[i].name)

    it('cmra finds camera first, fldr finds folder first', () => {
      expect(top('cmra')).toEqual(['camera'])
      expect(top('fldr')).toEqual(['folder'])
    })

    it('photo finds camera by its tag; CAMÉRA is camera', () => {
      expect(fuzzyFilter(set.hay, 'photo').map((i) => set.icons[i].name)).toContain('camera')
      expect(top('CAMÉRA')).toEqual(['camera'])
    })

    it('nonsense finds nothing', () => {
      expect(fuzzyFilter(set.hay, 'qqzzxxj')).toEqual([])
    })

    it('filters the whole set (with its tags) in a few milliseconds', () => {
      for (const q of ['cam', 'fldr']) fuzzyFilter(set.hay, q) // warm
      const runs = ['c', 'cmra', 'folder open', 'photo', 'arrow', 'zz']
      const t0 = performance.now()
      for (let i = 0; i < 5; i += 1) for (const q of runs) fuzzyFilter(set.hay, q)
      const each = (performance.now() - t0) / (5 * runs.length)
      // Measured about 1 to 2ms a query on the dev box; 10ms leaves a CI
      // runner room.
      expect(each).toBeLessThan(10)
    })
  })
})
