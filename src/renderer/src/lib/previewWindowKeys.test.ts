import { describe, expect, it } from 'vitest'
import { keyTarget, previewWindowKey, previewWindowStep } from './previewWindowKeys'

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

  it("a right-click menu up in the window keeps Space and Escape (owner, 2026-11-08)", () => {
    // Escape closes the menu alone; Space is the focused row's.
    expect(previewWindowKey(key('Escape'), null, true)).toBeNull()
    expect(previewWindowKey(key('Escape'), 'menu', true)).toBeNull()
    expect(previewWindowKey(key(' '), 'menu', true)).toBeNull()
    expect(previewWindowKey(key('Escape', { repeat: true }), null, true)).toBeNull()
    expect(previewWindowKey(key('Escape'), null, false)).toBe('close')
  })

  it('takes a Space under the menu, so the film below neither plays nor pauses (review 2026-11-08)', () => {
    expect(previewWindowKey(key(' '), null, true)).toBe('taken')
    expect(previewWindowKey(key(' ', { repeat: true }), null, true)).toBe('taken')
    // A field and the editor keep their Space, as with no menu.
    expect(previewWindowKey(key(' '), 'field', true)).toBeNull()
    expect(previewWindowKey(key(' '), 'editor', true)).toBeNull()
    expect(previewWindowKey(key(' ', { ctrlKey: true }), null, true)).toBeNull()
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
    const row = { isContentEditable: false, closest: (sel: string) => (sel.includes('menu') ? {} : null) }
    expect(keyTarget(row as unknown as EventTarget)).toBe('menu')
    expect(keyTarget(null)).toBeNull()
    expect(keyTarget({} as EventTarget)).toBeNull()
  })
})

describe('previewWindowStep (#492)', () => {
  it('walks on plain Up and Down', () => {
    expect(previewWindowStep(key('ArrowDown'), null, false, false)).toBe(1)
    expect(previewWindowStep(key('ArrowUp'), null, false, false)).toBe(-1)
  })
  it('walks from the film slider, not from a field', () => {
    expect(previewWindowStep(key('ArrowDown'), 'field', false, true)).toBe(1)
    expect(previewWindowStep(key('ArrowDown'), 'field', false, false)).toBeNull()
    expect(previewWindowStep(key('ArrowDown'), 'editor', false, false)).toBeNull()
  })
  it('leaves other keys, chords and an open menu alone', () => {
    expect(previewWindowStep(key('ArrowLeft'), null, false, false)).toBeNull()
    expect(previewWindowStep(key('ArrowDown', { shiftKey: true }), null, false, false)).toBeNull()
    expect(previewWindowStep(key('ArrowDown'), null, true, false)).toBeNull()
  })
})
