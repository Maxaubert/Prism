import { describe, expect, it, vi } from 'vitest'
import { zoomBlankMenu } from './zoomMenu'
import { GRID_STEP } from '../lib/explorerZoom'

// The blank-space menu of a folder (zoom grid spec 5.5): one row, the other
// way round from the look you are in.
describe('zoomBlankMenu', () => {
  it('in a list offers Show as grid, which sets the first tile step', () => {
    const setStep = vi.fn()
    const items = zoomBlankMenu({ step: 1, setStep })
    expect(items.map((i) => i.label)).toEqual(['Show as grid'])
    items[0].onPick?.()
    expect(setStep).toHaveBeenCalledWith(GRID_STEP)
    expect(GRID_STEP).toBe(6)
  })

  it('at every row step it is the same', () => {
    for (const step of [0, 1, 2, 3, 4])
      expect(zoomBlankMenu({ step, setStep: vi.fn() }).map((i) => i.label)).toEqual(['Show as grid'])
  })

  it('in a grid offers Show as list, which sets Medium', () => {
    const setStep = vi.fn()
    for (const step of [5, 6, 7, 8, 9]) {
      const items = zoomBlankMenu({ step, setStep })
      expect(items.map((i) => i.label)).toEqual(['Show as list'])
      items[0].onPick?.()
    }
    expect(setStep).toHaveBeenCalledTimes(5)
    expect(setStep).toHaveBeenLastCalledWith(1)
  })
})
