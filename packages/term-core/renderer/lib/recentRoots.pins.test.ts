import { beforeEach, describe, expect, it } from 'vitest'
import {
  forgetRoot,
  isPinned,
  pinnedRoots,
  plusMenuList,
  recentRoots,
  rememberRoot,
  togglePin,
  withPinToggled
} from './recentRoots'

beforeEach(() => localStorage.clear())

describe('pins (#99)', () => {
  it('toggles: pin appends, pin again removes, case-insensitively', () => {
    expect(withPinToggled([], 'C:\\a')).toEqual(['C:\\a'])
    expect(withPinToggled(['C:\\a'], 'C:\\b')).toEqual(['C:\\a', 'C:\\b'])
    expect(withPinToggled(['C:\\a', 'C:\\b'], 'c:\\A')).toEqual(['C:\\b'])
    expect(withPinToggled(['C:\\a'], '  ')).toEqual(['C:\\a'])
  })

  it('the menu is pins in pin order, then the newest unpinned recents', () => {
    const out = plusMenuList(['C:\\old', 'C:\\pinned'], ['C:\\pinned', 'C:\\new', 'C:\\old', 'C:\\x'], 2)
    expect(out).toEqual([
      { path: 'C:\\old', pinned: true },
      { path: 'C:\\pinned', pinned: true },
      { path: 'C:\\new', pinned: false },
      { path: 'C:\\x', pinned: false }
    ])
  })

  it('a pin outlives history: forgetting a folder and visiting others leave it', () => {
    togglePin('C:\\keep')
    forgetRoot('C:\\keep')
    for (let i = 0; i < 20; i += 1) rememberRoot(`C:\\f${i}`)
    expect(pinnedRoots()).toEqual(['C:\\keep'])
    expect(isPinned('c:\\KEEP')).toBe(true)
    expect(plusMenuList(pinnedRoots(), recentRoots())[0]).toEqual({ path: 'C:\\keep', pinned: true })
    togglePin('C:\\keep')
    expect(pinnedRoots()).toEqual([])
  })
})
