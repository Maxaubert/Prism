import { describe, expect, it } from 'vitest'
import { buildTermTheme } from './termTheme'

describe('buildTermTheme', () => {
  it('carries a derived ANSI palette: syntax adapts to the base', () => {
    const t = buildTermTheme('#7a1111', '#f5e9e9', '#5b5bd6')
    expect(t.red).toBeDefined()
    expect(t.red).not.toBe('#e05561') // adapted away from the seed on red
  })

  it('the style surfaces become the terminal surfaces', () => {
    const t = buildTermTheme('#000000', '#e3e6ea', '#7c7cf0')
    expect(t.background).toBe('#000000') // void: a black terminal
    expect(t.foreground).toBe('#e3e6ea')
    expect(t.cursor).toBe('#7c7cf0')
    expect(t.selectionBackground).toBe('#7c7cf055') // the accent, translucent
  })
  it('whitespace from getComputedStyle is trimmed', () => {
    expect(buildTermTheme(' #101215 ', ' #fff ', ' #5b5bd6 ').background).toBe('#101215')
  })
  it('a style that fails to answer falls back to the default dark', () => {
    const t = buildTermTheme('', '', '')
    expect(t.background).toBe('#0b0b0f')
    expect(t.foreground).toBe('#d7dae1')
    expect(t.cursor).toBe('#5b5bd6')
  })
})
