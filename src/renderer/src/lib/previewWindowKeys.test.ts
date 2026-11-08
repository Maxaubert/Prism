import { describe, expect, it } from 'vitest'
import { keyTarget, previewWindowKey } from './previewWindowKeys'

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
    expect(previewWindowKey(key(' '), null)).toBe('close')
    expect(previewWindowKey(key('Escape'), null)).toBe('close')
  })

  it('does nothing more for a held key', () => {
    expect(previewWindowKey(key(' ', { repeat: true }), null)).toBe('held')
  })

  it('leaves chords and other keys alone', () => {
    expect(previewWindowKey(key(' ', { ctrlKey: true }), null)).toBeNull()
    expect(previewWindowKey(key(' ', { shiftKey: true }), null)).toBeNull()
    expect(previewWindowKey(key('Escape', { altKey: true }), null)).toBeNull()
    expect(previewWindowKey(key('ArrowDown'), null)).toBeNull()
  })

  it('lets a field keep both, and the editor keep Space only', () => {
    expect(previewWindowKey(key(' '), 'field')).toBeNull()
    expect(previewWindowKey(key('Escape'), 'field')).toBeNull()
    expect(previewWindowKey(key(' '), 'editor')).toBeNull()
    expect(previewWindowKey(key('Escape'), 'editor')).toBe('close')
  })

  it('knows what a key landed on', () => {
    // What `closest` would find from each target, as the page's would.
    const at = (field: boolean, editable = false) => ({
      isContentEditable: editable,
      closest: (sel: string) => (field && /input/.test(sel) ? {} : null)
    })
    expect(keyTarget(at(true) as unknown as EventTarget)).toBe('field')
    expect(keyTarget(at(false) as unknown as EventTarget)).toBeNull()
    expect(keyTarget(at(false, true) as unknown as EventTarget)).toBe('editor')
    expect(keyTarget(null)).toBeNull()
    expect(keyTarget({} as EventTarget)).toBeNull()
  })
})
