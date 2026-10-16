import { describe, expect, it, vi } from 'vitest'
import { MAX_W, MIN_W, createPanelDrag } from './usePanelResize'

describe('the tree panel edge drag paints, it does not render (review, 2026-10-16)', () => {
  it('paints every move and keeps the width ONCE, on release', () => {
    const paint = vi.fn()
    const commit = vi.fn()
    const drag = createPanelDrag(paint, commit)
    for (let x = 200; x <= 400; x += 10) drag.move(x)
    expect(paint).toHaveBeenCalledTimes(21)
    expect(commit).not.toHaveBeenCalled()
    drag.end()
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith(400)
  })

  it('clamps what it paints and keeps, and a release with no move keeps nothing', () => {
    const paint = vi.fn()
    const commit = vi.fn()
    const drag = createPanelDrag(paint, commit)
    drag.end()
    expect(commit).not.toHaveBeenCalled()
    drag.move(5)
    expect(paint).toHaveBeenLastCalledWith(MIN_W)
    drag.move(5000)
    expect(paint).toHaveBeenLastCalledWith(MAX_W)
    drag.end()
    drag.end()
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith(MAX_W)
  })
})
