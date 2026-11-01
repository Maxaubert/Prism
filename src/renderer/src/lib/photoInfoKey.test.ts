import { describe, expect, it } from 'vitest'
import { photoInfoKeyToggles, type KeyLike } from './photoInfoKey'

// The I key's guards (#78), pinned outside the component. A fake element
// answers `closest` from the selectors its ancestors match.
const node = (...matches: string[]): Element =>
  ({
    closest: (sel: string) => (sel.split(',').some((s) => matches.includes(s.trim())) ? ({} as Element) : null)
  }) as unknown as Element

const key = (over: Partial<KeyLike> = {}): KeyLike => ({
  key: 'i',
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  repeat: false,
  ...over
})

const front = { offered: true, target: node(), stage: node() }

describe('the I key (#78)', () => {
  it('toggles on the front viewer, either case', () => {
    expect(photoInfoKeyToggles(key(), front)).toBe(true)
    expect(photoInfoKeyToggles(key({ key: 'I' }), front)).toBe(true)
  })

  it('only the I key', () => {
    expect(photoInfoKeyToggles(key({ key: 'r' }), front)).toBe(false)
  })

  it('not where the card is not offered (a comic page, no file)', () => {
    expect(photoInfoKeyToggles(key(), { ...front, offered: false })).toBe(false)
  })

  it('not as a chord', () => {
    expect(photoInfoKeyToggles(key({ ctrlKey: true }), front)).toBe(false)
    expect(photoInfoKeyToggles(key({ altKey: true }), front)).toBe(false)
    expect(photoInfoKeyToggles(key({ metaKey: true }), front)).toBe(false)
  })

  it('a held key counts once: no repeats', () => {
    expect(photoInfoKeyToggles(key({ repeat: true }), front)).toBe(false)
  })

  it('not over a menu or a dialog', () => {
    expect(photoInfoKeyToggles(key(), { ...front, target: node('[role="menu"]') })).toBe(false)
    expect(photoInfoKeyToggles(key(), { ...front, target: node('[role="dialog"]') })).toBe(false)
  })

  it('only the front viewer: a warm tab or a shut preview pane is inert', () => {
    // Every mounted picture listens on the window; two of them flipped the
    // one setting twice, so I did nothing with two picture tabs open.
    expect(photoInfoKeyToggles(key(), { ...front, stage: node('[inert]') })).toBe(false)
    expect(photoInfoKeyToggles(key(), { ...front, stage: null })).toBe(false)
  })
})
