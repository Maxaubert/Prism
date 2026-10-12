import { describe, expect, it, beforeEach } from 'vitest'
import { setStyle, setHeight, setPos, applyPreset, vizState } from './vizStore'

/**
 * A visualizer is a preset, not a shape.
 *
 * Each shipped look carries its own framing, and they are not interchangeable:
 * Halo is 88 tall and centred, Caps is 41 and centred, and the grounded shapes
 * sit at 56 low down because their bars rise from the transport. Changing only
 * the shape used to leave the previous look's numbers behind, so Halo rendered
 * at less than half its intended size and a wall of bars floated mid-window.
 *
 * The hand-set case is the other half of it: numbers a person chose must survive
 * a change of shape, or the height slider is a trap.
 */

const preset = (id: string): Parameters<typeof applyPreset>[0] => {
  const found = vizState().presets.find((p) => p.id === id)
  if (!found) throw new Error(`no preset ${id}`)
  return found
}

describe('changing the visualizer shape', () => {
  beforeEach(() => applyPreset(preset('caps')))

  it('brings the new shape its own framing', () => {
    expect(vizState().height).toBe(41) // Caps
    setStyle('ripples') // Halo
    expect(vizState().style).toBe('ripples')
    expect(vizState().height).toBe(88)
    expect(vizState().pos).toBe(50)
  })

  it('moves a grounded shape down where its bars can stand', () => {
    setStyle('segments') // Wall 2
    expect(vizState().height).toBe(56)
    expect(vizState().pos).toBe(72)
  })

  it('leaves a height the user chose alone', () => {
    setHeight(70)
    setStyle('ripples')
    expect(vizState().height).toBe(70)
    expect(vizState().style).toBe('ripples')
  })

  it('leaves a position the user chose alone', () => {
    setPos(30)
    setStyle('clean-wall')
    expect(vizState().pos).toBe(30)
  })

  it('says nothing about shapes that ship no preset of their own', () => {
    const before = vizState().height
    setStyle('not-a-real-style')
    expect(vizState().height).toBe(before)
  })
})
