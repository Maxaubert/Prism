import { describe, expect, it } from 'vitest'
import { clampPan, panBounds } from './imagePan'

// One firm flick at 4x used to put the photo entirely off stage, leaving an
// empty window with no visible way back.

const stage = { w: 1000, h: 800 }

describe('how far a picture may travel', () => {
  it('cannot move at all while it fits', () => {
    expect(panBounds({ width: 400, height: 300 }, stage, 1, 0)).toEqual({ x: 0, y: 0 })
  })

  it('may travel half its overhang once it is bigger than the stage', () => {
    // 2000 wide on a 1000 stage: 1000 of overhang, half either side.
    expect(panBounds({ width: 1000, height: 800 }, stage, 2, 0)).toEqual({ x: 500, y: 400 })
  })

  it('is per axis: a tall picture in a wide window moves only vertically', () => {
    expect(panBounds({ width: 500, height: 1600 }, stage, 1, 0)).toEqual({ x: 0, y: 400 })
  })

  it('swaps the axes when the picture is turned on its side', () => {
    // 2000x500 turned is 500 wide (narrower than the 1000 stage, so no travel)
    // and 2000 tall on an 800 stage, so 600 either way.
    expect(panBounds({ width: 2000, height: 500 }, stage, 1, 90)).toEqual({ x: 0, y: 600 })
  })

  it('treats 270 as turned too, and 180 as not', () => {
    expect(panBounds({ width: 2000, height: 500 }, stage, 1, 270)).toEqual({ x: 0, y: 600 })
    expect(panBounds({ width: 2000, height: 500 }, stage, 1, 180)).toEqual({ x: 500, y: 0 })
  })

  it('handles a negative rotation the same way', () => {
    expect(panBounds({ width: 2000, height: 500 }, stage, 1, -90)).toEqual({ x: 0, y: 600 })
  })
})

describe('clamping', () => {
  const b = { x: 100, y: 50 }
  it('leaves a translation inside the bounds alone', () => {
    expect(clampPan(30, -20, b)).toEqual([30, -20])
  })
  it('stops it at the edge in both directions', () => {
    expect(clampPan(9999, 9999, b)).toEqual([100, 50])
    expect(clampPan(-9999, -9999, b)).toEqual([-100, -50])
  })
  it('pins a picture that cannot move to dead centre', () => {
    expect(clampPan(400, 400, { x: 0, y: 0 })).toEqual([0, 0])
  })
})
