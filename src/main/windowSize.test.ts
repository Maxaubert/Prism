import { describe, expect, it } from 'vitest'
import { FIRST_WINDOW, firstWindow, restoredWindow } from './windowSize'

// The owner's screen: 3840 x 2160 at 225%, a work area of 1707 x 912 DIP.
const area = { x: 0, y: 0, width: 1707, height: 912 }
const displays = [{ workArea: area }]

describe('the window Prism opens (owner, 2026-10-11)', () => {
  it("opens at File Explorer's size when nothing is saved", () => {
    expect(FIRST_WINDOW).toEqual({ width: 933, height: 756 })
    expect(restoredWindow(null, displays, area)).toEqual({ width: 933, height: 756 })
  })

  it('keeps a size the user dragged to, and where it was', () => {
    const saved = { x: 120, y: 80, width: 1200, height: 700, maximised: false }
    expect(restoredWindow(saved, displays, area)).toEqual({ x: 120, y: 80, width: 1200, height: 700 })
  })

  it('never reopens maximized', () => {
    const saved = { x: 120, y: 80, width: 1200, height: 700, maximised: true }
    expect(restoredWindow(saved, displays, area)).toEqual({ x: 120, y: 80, width: 1200, height: 700 })
  })

  it('treats a saved size that fills the screen as no size (the owner had 1711 x 914)', () => {
    const saved = { x: 1, y: 4, width: 1711, height: 914, maximised: true }
    expect(restoredWindow(saved, displays, area)).toEqual({ width: 933, height: 756 })
  })

  it('drops a position no display holds any more', () => {
    const saved = { x: 5000, y: 80, width: 1200, height: 700 }
    expect(restoredWindow(saved, displays, area)).toEqual({ width: 1200, height: 700 })
  })

  it('holds the first window to 90% of a small screen', () => {
    expect(firstWindow({ width: 900, height: 600 })).toEqual({ width: 810, height: 540 })
  })

  it('reads anything malformed as nothing saved', () => {
    expect(restoredWindow({ width: 'big' }, displays, area)).toEqual({ width: 933, height: 756 })
  })
})
