import { describe, expect, it } from 'vitest'
import { SWEEP_ORIGIN, edgeWidth, toPhysical } from './sweepOverlayMath'
import type { SweepUpdate } from '@shared/sweepOverlay'

const msg = (dpr: number, cause: SweepUpdate['cause'] = 'auto'): SweepUpdate => ({
  id: 1,
  cause,
  anchor: { x: 100.4, y: 50.6 },
  clip: { left: 10.3, top: 20.7, right: 400.2, bottom: 300.5 },
  dpr
})
const none = { x: 0, y: 0 }

describe('the box in physical pixels', () => {
  it('maps at 100%', () => {
    expect(toPhysical(msg(1), none)).toEqual({
      ax: 100,
      ay: 51,
      left: 10,
      top: 20,
      right: 401,
      bottom: 301,
      edge: 1,
      cause: 'auto'
    })
  })

  it('maps at 150%: the anchor rounds, the clip grows outward', () => {
    const p = toPhysical(msg(1.5), none)
    expect([p.ax, p.ay]).toEqual([Math.round(150.6), Math.round(75.9)])
    expect([p.left, p.top, p.right, p.bottom]).toEqual([15, 31, 601, 451])
    expect(p.edge).toBe(2)
  })

  it('maps at 225%, and at 225% with a 110% zoom', () => {
    const p = toPhysical(msg(2.25), none)
    expect([p.ax, p.ay]).toEqual([226, 114])
    expect([p.left, p.top, p.right, p.bottom]).toEqual([23, 46, 901, 677])
    expect(p.edge).toBe(2)
    const z = toPhysical(msg(2.25 * 1.1), none)
    expect([z.ax, z.ay]).toEqual([Math.round(100.4 * 2.475), Math.round(50.6 * 2.475)])
    expect(z.left).toBe(Math.floor(10.3 * 2.475))
    expect(z.bottom).toBe(Math.ceil(300.5 * 2.475))
    expect(z.edge).toBe(2)
  })

  it('draws the edge Chromium draws for one CSS pixel', () => {
    expect(edgeWidth(1)).toBe(1)
    expect(edgeWidth(1.25)).toBe(1)
    expect(edgeWidth(1.5)).toBe(2)
    expect(edgeWidth(2.25)).toBe(2)
    expect(edgeWidth(3)).toBe(3)
    expect(edgeWidth(0.5)).toBe(1)
  })

  it('adds the client-to-target origin', () => {
    const p = toPhysical(msg(1), { x: 3, y: -2 })
    expect([p.ax, p.ay, p.left, p.top, p.right, p.bottom]).toEqual([103, 49, 13, 18, 404, 299])
  })

  it('carries the cause through, and none for a begin', () => {
    expect(toPhysical(msg(1, 'scroll'), none).cause).toBe('scroll')
    const { cause: _drop, id: _id, ...begin } = msg(1)
    expect(toPhysical(begin, none).cause).toBeUndefined()
  })

  it('uses the origin the spike measured: none, normal and maximised', () => {
    expect(SWEEP_ORIGIN).toEqual({ x: 0, y: 0 })
  })
})
