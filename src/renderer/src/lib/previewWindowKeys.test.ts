import { describe, expect, it } from 'vitest'
import { previewWindowKey, typesText } from './previewWindowKeys'

const key = (k: string, more: Partial<Parameters<typeof previewWindowKey>[0]> = {}) => ({
  key: k,
  code: k === ' ' ? 'Space' : k,
  repeat: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  ...more
})

describe('the preview window keys', () => {
  it('closes on Space and on Escape', () => {
    expect(previewWindowKey(key(' '), false)).toBe('close')
    expect(previewWindowKey(key('Escape'), false)).toBe('close')
  })

  it('does nothing more for a held key', () => {
    expect(previewWindowKey(key(' ', { repeat: true }), false)).toBe('held')
  })

  it('leaves chords, other keys and a field alone', () => {
    expect(previewWindowKey(key(' ', { ctrlKey: true }), false)).toBeNull()
    expect(previewWindowKey(key(' ', { shiftKey: true }), false)).toBeNull()
    expect(previewWindowKey(key('Escape', { altKey: true }), false)).toBeNull()
    expect(previewWindowKey(key('ArrowDown'), false)).toBeNull()
    expect(previewWindowKey(key(' '), true)).toBeNull()
    expect(previewWindowKey(key('Escape'), true)).toBeNull()
  })

  it('knows a target that types', () => {
    // What `closest` would find from each target, as the page's would.
    const at = (match: boolean, editable = false) => ({
      isContentEditable: editable,
      closest: (sel: string) => (match && /input/.test(sel) ? {} : null)
    })
    expect(typesText(at(true) as unknown as EventTarget)).toBe(true)
    expect(typesText(at(false) as unknown as EventTarget)).toBe(false)
    expect(typesText(at(false, true) as unknown as EventTarget)).toBe(true)
    expect(typesText(null)).toBe(false)
    expect(typesText({} as EventTarget)).toBe(false)
  })
})
