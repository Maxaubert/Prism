import { describe, expect, it } from 'vitest'
import { absoluteStart, elementToPath, iconToPaths, num } from './svgToPath.mjs'

describe('svgToPath', () => {
  it('writes numbers short and exact to 3 decimals', () => {
    expect(num(2)).toBe('2')
    expect(num(1.23456)).toBe('1.235')
    expect(num(-0.0001)).toBe('0')
  })

  it('a path keeps its d; a leading relative moveto becomes absolute', () => {
    expect(elementToPath('path', { d: 'M3 3h18' })).toBe('M3 3h18')
    expect(absoluteStart('m2 2 20 20')).toBe('M2 2l20 20')
    expect(absoluteStart('m12 5 7 7-7 7')).toBe('M12 5l7 7 -7 7')
    expect(absoluteStart('m9 18 6-6')).toBe('M9 18l6 -6')
    expect(absoluteStart('m4.5 1.5v2')).toBe('M4.5 1.5v2')
  })

  it('a circle and an ellipse are two half arcs', () => {
    expect(elementToPath('circle', { cx: '12', cy: '13', r: '3' })).toBe('M9 13a3 3 0 1 0 6 0a3 3 0 1 0 -6 0')
    expect(elementToPath('ellipse', { cx: '12', cy: '5', rx: '9', ry: '3' })).toBe('M3 5a9 3 0 1 0 18 0a9 3 0 1 0 -18 0')
  })

  it('a rect, square or rounded (rx alone, ry alone, both, clamped)', () => {
    expect(elementToPath('rect', { x: '3', y: '4', width: '18', height: '16' })).toBe('M3 4h18v16h-18z')
    expect(elementToPath('rect', { x: '2', y: '2', width: '20', height: '8', rx: '2' })).toBe(
      'M4 2h16a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2v-4a2 2 0 0 1 2 -2z'
    )
    expect(elementToPath('rect', { x: '0', y: '0', width: '4', height: '4', ry: '1' })).toBe(
      'M1 0h2a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1v-2a1 1 0 0 1 1 -1z'
    )
    expect(elementToPath('rect', { x: '0', y: '0', width: '4', height: '2', rx: '9', ry: '9' })).toBe(
      'M2 0h0a2 1 0 0 1 2 1v0a2 1 0 0 1 -2 1h0a2 1 0 0 1 -2 -1v0a2 1 0 0 1 2 -1z'
    )
  })

  it('a line, a polyline and a polygon', () => {
    expect(elementToPath('line', { x1: '12', y1: '2', x2: '12', y2: '22' })).toBe('M12 2L12 22')
    expect(elementToPath('polyline', { points: '4 7 4 4 20 4 20 7' })).toBe('M4 7L4 4L20 4L20 7')
    expect(elementToPath('polygon', { points: '12,2 22,22 2,22' })).toBe('M12 2L22 22L2 22z')
  })

  it('an icon joins its parts, and keeps filled dots apart', () => {
    const { d, fill } = iconToPaths([
      ['path', { d: 'm2 2 4 4' }],
      ['circle', { cx: '12', cy: '12', r: '1', fill: 'currentColor' }]
    ])
    expect(d).toBe('M2 2l4 4M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0')
    expect(fill).toBe('M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0')
    expect(iconToPaths([['line', { x1: '0', y1: '0', x2: '1', y2: '1' }]]).fill).toBeUndefined()
  })
})
