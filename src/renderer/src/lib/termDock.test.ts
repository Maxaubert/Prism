import { beforeEach, describe, expect, it } from 'vitest'
import { clampTermSize, dockAxis, dockFlex, loadDock, loadTermSize, saveDock, saveTermSize } from './termDock'

beforeEach(() => localStorage.clear())

describe('dock geometry', () => {
  it('viewer stays first in DOM: bottom/right plain, top/left reversed', () => {
    expect(dockFlex('bottom')).toBe('column')
    expect(dockFlex('top')).toBe('column-reverse')
    expect(dockFlex('right')).toBe('row')
    expect(dockFlex('left')).toBe('row-reverse')
  })
  it('one remembered size per axis', () => {
    expect(dockAxis('bottom')).toBe('y')
    expect(dockAxis('top')).toBe('y')
    expect(dockAxis('left')).toBe('x')
    expect(dockAxis('right')).toBe('x')
  })
  it('clamps to something usable at both ends', () => {
    expect(clampTermSize(10, 1000)).toBe(90)
    expect(clampTermSize(950, 1000)).toBe(800)
    expect(clampTermSize(300, 1000)).toBe(300)
  })
  it('round-trips the edge and survives garbage', () => {
    saveDock('left')
    expect(loadDock()).toBe('left')
    localStorage.setItem('prism.term.dock', 'diagonal')
    expect(loadDock()).toBe('bottom')
  })
  it('round-trips a size per axis, defaulting sensibly', () => {
    expect(loadTermSize('y')).toBe(240)
    expect(loadTermSize('x')).toBe(360)
    saveTermSize('y', 300)
    expect(loadTermSize('y')).toBe(300)
    expect(loadTermSize('x')).toBe(360) // the other axis is untouched
    localStorage.setItem('prism.term.w', 'soup')
    expect(loadTermSize('x')).toBe(360)
  })
})
