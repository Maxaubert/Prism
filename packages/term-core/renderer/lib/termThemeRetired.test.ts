import { beforeEach, describe, expect, it } from 'vitest'
import { TERM_PRESETS, resolveTermTheme } from './termTheme'
import { RETIRED_THEMES, liveThemeId } from './termThemeRetired'
import { termThemeId } from './termLook'

const ids = new Set(TERM_PRESETS.map((p) => p.id))

describe('the theme list (owner, 2026-09-23: each its own; 2026-09-24: forty; 2026-10-11: High Contrast out)', () => {
  it('is thirty-nine, and every id and name is unique', () => {
    expect(TERM_PRESETS.length).toBe(39)
    expect(ids.size).toBe(TERM_PRESETS.length)
    expect(new Set(TERM_PRESETS.map((p) => p.name)).size).toBe(TERM_PRESETS.length)
  })

  it('has the brown, pink and green pairs, dark and light', () => {
    for (const id of ['umber', 'fawn', 'rosewood', 'blossom', 'moss', 'sage']) expect(ids.has(id)).toBe(true)
  })
})

describe('retired themes', () => {
  beforeEach(() => localStorage.clear())

  it('each goes to a theme that is still in the list, and none is itself still listed', () => {
    for (const [old, now] of Object.entries(RETIRED_THEMES)) {
      expect(ids.has(now), `${old} -> ${now}`).toBe(true)
      expect(ids.has(old), `${old} is retired but still listed`).toBe(false)
    }
  })

  it('a kept id is itself', () => {
    expect(liveThemeId('pitch')).toBe('pitch')
  })

  it('somebody who wore a retired theme wears its replacement, not the default', () => {
    localStorage.setItem('prism.term.theme', 'espresso')
    expect(termThemeId()).toBe('umber')
    const umber = TERM_PRESETS.find((p) => p.id === 'umber')!
    expect(resolveTermTheme('espresso').background).toBe(umber.bg)
  })
})
