import { beforeEach, describe, expect, it } from 'vitest'
import {
  CUSTOM_KEY,
  customTermTheme,
  onTermLookChange,
  saveCustomTermTheme,
  setTermThemeId,
  setThemeDraft,
  themeDraft
} from './termLook'
import { presetAccent, resolveSavedTheme, resolveTermTheme } from './termTheme'
import { paletteOf, presetLook } from '../settings/theme/palette'
import { saveAsCustom } from '../settings/theme/useTermSetup'

// Owner, 2026-10-12: PT Default, its cursor edited and saved, "changed the
// accent colour to blue"; and the editor's picks should "apply instantly so
// that I can ctrl tab to see how it actually looks".

beforeEach(() => {
  localStorage.clear()
  setThemeDraft(null)
})

describe('a Custom keeps the accent of the theme it was made from', () => {
  it('PT Default edited and saved keeps its orange, not the palette blue', () => {
    setTermThemeId('pt-default')
    const p = paletteOf('pt-default')
    expect(p.accent).toBe('#fe8f34')
    saveAsCustom({ ...p, cursor: '#ff00aa' })
    expect(customTermTheme()?.accent).toBe('#fe8f34')
    expect(presetAccent('custom')).toBe('#fe8f34')
  })
  it('a Custom edited again keeps it', () => {
    saveCustomTermTheme({ ...paletteOf('pt-default'), cursor: '#ff00aa' })
    setTermThemeId('custom')
    expect(paletteOf('custom').accent).toBe('#fe8f34')
  })
  it('an older Custom with no accent, or a broken one, asks for none', () => {
    saveCustomTermTheme({ bg: '#111111', fg: '#eeeeee', cursor: '#ffffff', ansi: {} })
    expect(presetAccent('custom')).toBeUndefined()
    localStorage.setItem(CUSTOM_KEY, JSON.stringify({ bg: '#111111', fg: '#eeeeee', cursor: '#fff', ansi: {}, accent: 'nope' }))
    expect(customTermTheme()?.accent).toBeUndefined()
  })
})

describe("the editor's draft is worn while it is open", () => {
  it('the theme in force resolves to the draft, and tells every listener', () => {
    setTermThemeId('pt-default')
    let heard = 0
    const off = onTermLookChange(() => heard++)
    setThemeDraft({ ...paletteOf('pt-default'), cursor: '#ff00aa', accent: '#00ff88' })
    off()
    expect(heard).toBe(1)
    expect(resolveTermTheme('pt-default').cursor).not.toBe(resolveSavedTheme('pt-default').cursor)
    expect(presetAccent('pt-default')).toBe('#00ff88')
  })
  it("another theme's card, and the preset cache, never see it", () => {
    setTermThemeId('pt-default')
    const before = presetLook('pt-default').cursor
    setThemeDraft({ ...paletteOf('pt-default'), cursor: '#ff00aa' })
    expect(presetLook('pt-default').cursor).toBe(before)
    expect(resolveTermTheme('prism')).toEqual(resolveSavedTheme('prism'))
  })
  it('Cancel drops it: the saved theme is back', () => {
    setTermThemeId('pt-default')
    setThemeDraft({ ...paletteOf('pt-default'), cursor: '#ff00aa' })
    setThemeDraft(null)
    expect(themeDraft()).toBeNull()
    expect(resolveTermTheme('pt-default')).toEqual(resolveSavedTheme('pt-default'))
    expect(presetAccent('pt-default')).toBe('#fe8f34')
  })
})
