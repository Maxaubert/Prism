import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { acrylicLevel } from '../theme'
import { migrateThemes, migrateThemeStorage, ONYX_LEVEL, RETIRED_KEY, VERSION_KEY } from './migrate'
import { retiredById } from './retired'

// SAVED THEMES MOVE ONCE (#298, spec 4): every retired id deliberately mapped,
// nobody silently on the default, the draft and own copies kept.

const DRAFT = 'prism.style.draft'
const PRESETS = 'prism.style.presets'
const STYLE = 'prism.style'

describe('the map', () => {
  const cases: Array<[string, string, string | null]> = [
    ['aurora', 'aurora', null],
    ['new-void', 'new-void', null],
    ['frost', 'frost', null],
    ['paper', 'paper', null],
    ['orchid', 'orchid', null],
    ['default', 'new-void', 'Onyx'],
    ['terminal', 'obsidian', 'Terminal'],
    ['driftwood', 'carbon', 'Driftwood'],
    ['acrylic-red', 'ember', 'Ruby'],
    ['linen', 'sand', 'Linen']
  ]
  for (const [was, now, name] of cases) {
    it(`${was} becomes ${now}`, () => {
      const m = migrateThemes({ [STYLE]: was })
      if (now === was) expect(m.set).not.toHaveProperty(STYLE)
      else expect(m.set[STYLE]).toBe(now)
      if (name) expect(m.set[RETIRED_KEY]).toBe(name)
      else expect(m.set).not.toHaveProperty(RETIRED_KEY)
      expect(m.set[VERSION_KEY]).toBe('2')
    })
  }

  it('leaves an own copy and an unknown id alone (the store falls back to Aurora)', () => {
    expect(migrateThemes({ [STYLE]: 'custom-0-1-Customtheme1' }).set).toEqual({ [VERSION_KEY]: '2' })
    expect(migrateThemes({ [STYLE]: 'nonsense' }).set).toEqual({ [VERSION_KEY]: '2' })
    expect(migrateThemes({}).set).toEqual({ [VERSION_KEY]: '2' })
  })
})

describe("Onyx's glass", () => {
  it('is its old Acrylic level, 55', () => {
    expect(ONYX_LEVEL).toBe(55)
    expect(ONYX_LEVEL).toBe(acrylicLevel(retiredById('default')!))
  })

  it('is carried to Void as an unsaved edit, the rest of the draft kept', () => {
    const m = migrateThemes({ [STYLE]: 'default', [DRAFT]: JSON.stringify({ accent: '#ff0000' }) })
    expect(JSON.parse(m.set[DRAFT])).toEqual({ accent: '#ff0000', acrylic: 55 })
  })

  it('is not written over a draft that already says how much glass', () => {
    for (const acrylic of [0, 20]) {
      const m = migrateThemes({ [STYLE]: 'default', [DRAFT]: JSON.stringify({ acrylic }) })
      expect(m.set).not.toHaveProperty(DRAFT)
    }
  })

  it('survives a draft that is junk', () => {
    const m = migrateThemes({ [STYLE]: 'default', [DRAFT]: '{nope' })
    expect(JSON.parse(m.set[DRAFT])).toEqual({ acrylic: 55 })
  })

  it('only Onyx gets glass', () => {
    expect(migrateThemes({ [STYLE]: 'terminal', [DRAFT]: '{}' }).set).not.toHaveProperty(DRAFT)
  })
})

describe('own copies', () => {
  const copies = [
    { id: 'custom-1', name: 'Custom theme 1', base: 'default', bg: '#000000', text: '#ffffff', mode: 'dark', glass: 0.5 },
    { id: 'custom-2', name: 'Custom theme 2', base: 'linen', bg: '#f8f4ed', text: '#241f18', mode: 'light' },
    { id: 'custom-3', name: 'Custom theme 3', base: 'aurora', bg: '#0b0d12', text: '#f2f4f8', mode: 'dark' }
  ]

  it('are kept field for field, their base mapped', () => {
    const m = migrateThemes({ [PRESETS]: JSON.stringify(copies) })
    const out = JSON.parse(m.set[PRESETS])
    expect(out).toEqual([
      { ...copies[0], base: 'new-void' },
      { ...copies[1], base: 'sand' },
      copies[2]
    ])
  })

  it('are not rewritten when no base was retired, nor when the list is junk', () => {
    expect(migrateThemes({ [PRESETS]: JSON.stringify([copies[2]]) }).set).not.toHaveProperty(PRESETS)
    expect(migrateThemes({ [PRESETS]: 'not json' }).set).not.toHaveProperty(PRESETS)
    expect(migrateThemes({ [PRESETS]: JSON.stringify({ a: 1 }) }).set).not.toHaveProperty(PRESETS)
  })
})

describe('once', () => {
  it('does nothing once the marker is set', () => {
    expect(migrateThemes({ [VERSION_KEY]: '2', [STYLE]: 'default' })).toEqual({ set: {}, remove: [] })
  })

  it('does not read Colour mode for the choice', () => {
    const a = migrateThemes({ [STYLE]: 'driftwood', 'prism.mode': 'light' })
    const b = migrateThemes({ [STYLE]: 'driftwood', 'prism.mode': 'dark' })
    expect(a).toEqual(b)
    expect(a.set[STYLE]).toBe('carbon')
  })

  it('applied to storage, a second run changes nothing', () => {
    const store = new Map<string, string>([
      [STYLE, 'default'],
      [DRAFT, '{}']
    ])
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k)
    }
    migrateThemeStorage(storage)
    const after = new Map(store)
    expect(after.get(STYLE)).toBe('new-void')
    expect(after.get(VERSION_KEY)).toBe('2')
    expect(after.get(RETIRED_KEY)).toBe('Onyx')
    migrateThemeStorage(storage)
    expect(store).toEqual(after)
  })
})

describe('at the store', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    vi.stubGlobal('window', new EventTarget())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('runs before the first paint: an Onyx profile opens on Void with its glass', async () => {
    localStorage.setItem(STYLE, 'default')
    localStorage.setItem('prism.mode', 'light')
    const theme = await import('../theme')
    const shown = theme.currentStyle()
    expect(shown.id).toBe('new-void')
    expect(shown.material).toBe('acrylic')
    expect(theme.isEdited()).toBe(true)
    // The mode key is the boot screen's mirror of what is painted.
    expect(localStorage.getItem('prism.mode')).toBe('dark')
    expect(localStorage.getItem(RETIRED_KEY)).toBe('Onyx')
    // The first theme pick takes the one-time line away.
    theme.setStyle('paper')
    expect(localStorage.getItem(RETIRED_KEY)).toBeNull()
    expect(localStorage.getItem('prism.mode')).toBe('light')
  })

  it('deleting an own copy of a retired style lands on its mapped theme', async () => {
    localStorage.setItem(PRESETS, JSON.stringify([{ ...retiredById('linen')!, id: 'custom-9', name: 'Custom theme 1', custom: true, base: 'linen' }]))
    localStorage.setItem(STYLE, 'custom-9')
    const theme = await import('../theme')
    expect(theme.currentStyle().id).toBe('custom-9')
    theme.deletePreset('custom-9')
    expect(theme.currentStyle().id).toBe('sand')
  })
})
