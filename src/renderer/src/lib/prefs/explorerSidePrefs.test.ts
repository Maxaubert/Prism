import { beforeEach, describe, expect, it } from 'vitest'
import { explorerSide, explorerSideOf, reloadExplorerSide, setExplorerSide } from './explorerSidePrefs'

// Two Sidebar positions (#304; owner, 2026-10-07: "No, it should be two
// settings, one on the project tab and one on the explorer tab").
describe("the Explorer's sidebar position", () => {
  beforeEach(() => {
    localStorage.clear()
    reloadExplorerSide()
  })

  it('is Left until somebody chooses', () => {
    expect(explorerSide()).toBe('left')
  })

  it('reads anything but Right as Left', () => {
    expect(explorerSideOf(null)).toBe('left')
    expect(explorerSideOf('middle')).toBe('left')
    expect(explorerSideOf('right')).toBe('right')
  })

  it('is its own key, and leaves the project tree alone', () => {
    setExplorerSide('right')
    expect(localStorage.getItem('prism.explorer.side')).toBe('right')
    expect(localStorage.getItem('prism.tree.side')).toBeNull()
    reloadExplorerSide()
    expect(explorerSide()).toBe('right')
  })
})
