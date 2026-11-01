import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watchBounds, type BoundsWindow } from './windowBounds'
import type { SavedBounds } from './session'

// #25 (2026-11-01): the size and place a window had when it closed is what
// comes back. A move or resize is reported 400 ms late, so a close inside
// that wait used to lose the last drag, or report nothing at all.

function fakeWindow(): BoundsWindow & {
  emit: (e: string) => boolean
  box: { x: number; y: number; width: number; height: number }
} {
  const em = new EventEmitter()
  const box = { x: 10, y: 20, width: 800, height: 600 }
  return Object.assign(em, {
    box,
    isDestroyed: () => false,
    isMinimized: () => false,
    isMaximized: () => false,
    getNormalBounds: () => ({ ...box })
  })
}

describe('a window reports where it was (#25)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports a drag once it settles, not on every pixel', () => {
    const win = fakeWindow()
    const got: SavedBounds[] = []
    watchBounds(win, (b) => got.push(b))
    win.box.x = 50
    win.emit('move')
    win.box.x = 60
    win.emit('move')
    expect(got).toEqual([])
    vi.advanceTimersByTime(400)
    expect(got).toEqual([{ x: 60, y: 20, width: 800, height: 600, maximised: false }])
  })

  it('reports the bounds AT ONCE on close, inside the wait, and never twice', () => {
    const win = fakeWindow()
    const got: SavedBounds[] = []
    watchBounds(win, (b) => got.push(b))
    win.box.width = 1000
    win.emit('resize')
    win.emit('close')
    expect(got).toEqual([{ x: 10, y: 20, width: 1000, height: 600, maximised: false }])
    // The cancelled wait does not report again after the window has gone.
    vi.advanceTimersByTime(1000)
    expect(got).toHaveLength(1)
  })

  it('reports nothing for a minimised window, whose bounds are not a place', () => {
    const win = fakeWindow()
    win.isMinimized = () => true
    const got: SavedBounds[] = []
    watchBounds(win, (b) => got.push(b))
    win.emit('close')
    expect(got).toEqual([])
  })
})
