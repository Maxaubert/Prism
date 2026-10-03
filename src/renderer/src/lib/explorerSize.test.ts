import { beforeEach, describe, expect, it } from 'vitest'
import {
  EXPLORER_SIZES,
  explorerRow,
  explorerSize,
  explorerSizeOf,
  reloadExplorerSize,
  setExplorerSize
} from './explorerSize'
import { TREE_SIZES, rowLook } from './treePrefs'

// Settings > Style > Explorer size (owner, 2026-10-03: "let the current be
// medium the old be big, and make a slightly smaller version too").
describe('explorer size', () => {
  beforeEach(() => {
    localStorage.clear()
    reloadExplorerSize()
  })

  it('is Medium until somebody chooses', () => {
    expect(explorerSize()).toBe('medium')
  })

  it('offers Small, Medium and Large in that order', () => {
    expect(EXPLORER_SIZES.map((s) => s.name)).toEqual(['Small', 'Medium', 'Large'])
  })

  it('Medium is the tree row at its default size, the Explorer since #257', () => {
    expect(explorerRow('medium')).toEqual(rowLook(TREE_SIZES.find((s) => s.id === 'default')!))
    expect(explorerRow('medium')).toMatchObject({ height: 26, font: 12.5, icon: 14 })
  })

  it('Large is the old Explorer: 40px rows, 15px text, an 18px icon and the old spacing', () => {
    expect(explorerRow('large')).toEqual({ height: 40, font: 15, icon: 18, gap: 12, padX: 16 })
  })

  it('Small is a step under Medium in every part', () => {
    const s = explorerRow('small')
    const m = explorerRow('medium')
    expect(s.height).toBe(22)
    expect(s.font).toBeLessThan(m.font)
    expect(s.icon).toBeLessThan(m.icon)
    expect(s.gap).toBeLessThanOrEqual(m.gap)
  })

  it('remembers each choice under its own key, and a fresh launch reads it back', () => {
    for (const id of ['small', 'large', 'medium'] as const) {
      setExplorerSize(id)
      expect(explorerSize()).toBe(id)
      expect(localStorage.getItem('prism.explorer.size')).toBe(id)
      reloadExplorerSize()
      expect(explorerSize()).toBe(id)
    }
  })

  it('reads anything it does not know as Medium, and never stores it', () => {
    for (const bad of ['huge', '', 'Large', null, 3, undefined]) expect(explorerSizeOf(bad)).toBe('medium')
    localStorage.setItem('prism.explorer.size', 'enormous')
    reloadExplorerSize()
    expect(explorerSize()).toBe('medium')
    setExplorerSize('tiny' as never)
    expect(localStorage.getItem('prism.explorer.size')).toBe('medium')
  })

  it('an unknown id still draws a row', () => {
    expect(explorerRow('nope' as never)).toEqual(explorerRow('medium'))
  })
})
