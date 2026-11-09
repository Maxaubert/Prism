import { beforeEach, describe, expect, it } from 'vitest'
import { EXPLORER_SIZES, explorerRow } from './explorerSize'
import {
  ZOOM_MAX_AVAILABLE,
  ZOOM_STEPS,
  atStep,
  explorerZoom,
  headSizeOf,
  reloadExplorerZoom,
  setExplorerZoom,
  zoomIn,
  zoomOut,
  zoomStepOf
} from './explorerZoom'

// Ctrl+scroll in the Explorer changes ONE step (owner, 2026-11-09). Steps 0 to
// 2 are the three Settings sizes; 3 and up are the roomier rows.
describe('explorer zoom steps', () => {
  beforeEach(() => {
    localStorage.clear()
    reloadExplorerZoom()
  })

  it('steps 0 to 2 are exactly the old Small, Medium and Large looks', () => {
    EXPLORER_SIZES.forEach((s, i) => {
      const { height, font, icon, gap, padX } = ZOOM_STEPS[i]
      expect({ height, font, icon, gap, padX }).toEqual(s.row)
    })
  })

  it('rows only get taller, and a step is a full look', () => {
    for (let i = 1; i < ZOOM_STEPS.length; i++) expect(ZOOM_STEPS[i].height).toBeGreaterThan(ZOOM_STEPS[i - 1].height)
    expect(ZOOM_STEPS.map((s) => s.height).slice(3)).toEqual([56, 76])
    for (const s of ZOOM_STEPS) for (const k of ['height', 'font', 'icon', 'gap', 'padX'] as const) expect(s[k]).toBeGreaterThan(0)
  })

  it('offers steps 0 to 4 until the grid exists', () => {
    expect(ZOOM_MAX_AVAILABLE).toBe(4)
    expect(ZOOM_STEPS).toHaveLength(ZOOM_MAX_AVAILABLE + 1)
  })

  it('starts at Medium, or at the old Explorer size when that was set', () => {
    expect(explorerZoom()).toBe(1)
    for (const [size, step] of [['small', 0], ['medium', 1], ['large', 2], ['bogus', 1]] as const) {
      localStorage.clear()
      localStorage.setItem('prism.explorer.size', size)
      reloadExplorerZoom()
      expect(explorerZoom(), size).toBe(step)
    }
  })

  it('a saved step beats the old size, and survives a fresh launch', () => {
    localStorage.setItem('prism.explorer.size', 'large')
    setExplorerZoom(4)
    expect(localStorage.getItem('prism.explorer.zoom')).toBe('4')
    reloadExplorerZoom()
    expect(explorerZoom()).toBe(4)
  })

  it('clamps numbers and turns junk into the default', () => {
    expect(zoomStepOf('3')).toBe(3)
    expect(zoomStepOf('-2')).toBe(0)
    expect(zoomStepOf('99')).toBe(ZOOM_MAX_AVAILABLE)
    for (const bad of ['', 'x', '2.5', 'NaN', 'Infinity']) expect(zoomStepOf(bad, 2), bad).toBe(2)
    expect(zoomStepOf(null, 2)).toBe(2)
  })

  it('zooms in and out one step, and stops at the ends', () => {
    expect(zoomIn(1)).toBe(2)
    expect(zoomOut(1)).toBe(0)
    expect(zoomOut(0)).toBe(0)
    expect(zoomIn(ZOOM_MAX_AVAILABLE)).toBe(ZOOM_MAX_AVAILABLE)
  })

  it('names the Settings size a step stands for, and the header follows Large from 2 up', () => {
    expect([0, 1, 2, 3, 4].map(headSizeOf)).toEqual(['small', 'medium', 'large', 'large', 'large'])
    expect(atStep(1)).toBe(ZOOM_STEPS[1])
    expect(atStep(77)).toBe(ZOOM_STEPS[ZOOM_MAX_AVAILABLE])
    expect(atStep(-1)).toBe(ZOOM_STEPS[0])
    expect(atStep(1)).toMatchObject(explorerRow('medium'))
  })
})
