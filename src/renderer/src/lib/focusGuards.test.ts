import { describe, expect, it } from 'vitest'
import {
  EDITOR,
  FIELD,
  NAV_SURFACE,
  OVERLAY,
  isFormField,
  isTextBox,
  isTypingTarget
} from './focusGuards'

// The lists every key handler yields to. A change here changes which keys
// reach Prism from a field, an editor, a dialog or the folder's surfaces, so
// it is made on purpose, here, and not in a handler's own copy.

const el = (tagName: string, isContentEditable = false): HTMLElement =>
  ({ tagName, isContentEditable }) as unknown as HTMLElement

describe('focus guards', () => {
  it('pins the selector lists', () => {
    expect(FIELD).toBe('input,textarea,select,[contenteditable]:not([contenteditable="false"])')
    expect(EDITOR).toBe('.cm-editor,.xterm')
    expect(OVERLAY).toBe('[role="dialog"],[role="menu"]')
    expect(NAV_SURFACE).toBe(
      '[data-project-sidebar],.folder-browser,.browse-viewer-places,[role="separator"]'
    )
  })

  it('a typing target is a field or anything contenteditable', () => {
    for (const t of ['INPUT', 'TEXTAREA', 'SELECT']) expect(isTypingTarget(el(t))).toBe(true)
    expect(isTypingTarget(el('DIV', true))).toBe(true)
    expect(isTypingTarget(el('BUTTON'))).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })

  it('a form field is input, textarea or select, never contenteditable', () => {
    for (const t of ['INPUT', 'TEXTAREA', 'SELECT']) expect(isFormField(el(t))).toBe(true)
    expect(isFormField(el('DIV', true))).toBe(false)
    expect(isFormField(undefined)).toBe(false)
  })

  it('a text box is input or textarea only', () => {
    expect(isTextBox(el('INPUT'))).toBe(true)
    expect(isTextBox(el('TEXTAREA'))).toBe(true)
    expect(isTextBox(el('SELECT'))).toBe(false)
    expect(isTextBox(el('DIV', true))).toBe(false)
  })
})
