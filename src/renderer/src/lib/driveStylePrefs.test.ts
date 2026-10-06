import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DRIVE_STYLES,
  driveStyle,
  driveStyleOf,
  reloadDriveStyle,
  setDriveStyle
} from './driveStylePrefs'

// Settings > Explorer > Drive style (owner, 2026-10-06: "option A, D and E as
// options in settings, with A being default").
describe('drive style', () => {
  beforeEach(() => {
    localStorage.clear()
    reloadDriveStyle()
  })

  it('is Tiles until somebody chooses', () => {
    expect(driveStyle()).toBe('tiles')
  })

  it('offers Tiles, Ring and Gauge in that order', () => {
    expect(DRIVE_STYLES.map((s) => [s.id, s.name])).toEqual([
      ['tiles', 'Tiles'],
      ['ring', 'Ring'],
      ['gauge', 'Gauge']
    ])
  })

  it('is stored under its own key and read back at the next launch', () => {
    setDriveStyle('gauge')
    expect(localStorage.getItem('prism.sidebar.driveStyle')).toBe('gauge')
    reloadDriveStyle()
    expect(driveStyle()).toBe('gauge')
  })

  it('reads anything it does not know as Tiles', () => {
    for (const raw of [null, '', 'bars', 'RING', 7, undefined]) expect(driveStyleOf(raw)).toBe('tiles')
    localStorage.setItem('prism.sidebar.driveStyle', 'donut')
    reloadDriveStyle()
    expect(driveStyle()).toBe('tiles')
  })

  it('lasts the session when storage refuses', () => {
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    setDriveStyle('ring')
    expect(driveStyle()).toBe('ring')
    spy.mockRestore()
  })
})
