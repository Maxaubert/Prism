import { describe, expect, it, vi } from 'vitest'
import { binPlaceMenu } from './binRow'

const build = (
  over: Partial<Parameters<typeof binPlaceMenu>[0]> = {}
): ReturnType<typeof binPlaceMenu> =>
  binPlaceMenu({ onOpen: vi.fn(), onOpenNewTab: vi.fn(), onEmpty: vi.fn(), ...over })

describe('binPlaceMenu (the sidebar Recycle Bin row, D19)', () => {
  it('has Open, Open in new tab, Empty Recycle Bin, in that order, and nothing else', () => {
    expect(build().map((i) => i.label)).toEqual(['Open', 'Open in new tab', 'Empty Recycle Bin'])
  })
  it('has no pin rows: the row is not a pin', () => {
    const labels = build().map((i) => i.label)
    expect(labels.some((l) => /pin|properties|copy path/i.test(l))).toBe(false)
  })
  it('each row calls its own action', () => {
    const onOpen = vi.fn()
    const onOpenNewTab = vi.fn()
    const onEmpty = vi.fn()
    const items = build({ onOpen, onOpenNewTab, onEmpty })
    items[0].onPick?.()
    items[1].onPick?.()
    items[2].onPick?.()
    expect([onOpen, onOpenNewTab, onEmpty].map((f) => f.mock.calls.length)).toEqual([1, 1, 1])
  })
  it('a row whose action is absent is disabled, not hidden', () => {
    const items = build({ onOpenNewTab: undefined, onEmpty: undefined })
    expect(items.filter((i) => i.disabled).map((i) => i.label)).toEqual([
      'Open in new tab',
      'Empty Recycle Bin'
    ])
  })
})
