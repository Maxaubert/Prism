import { describe, expect, it, vi } from 'vitest'
import { termKeyAction, type TermKeyEvent } from './termKeys'

const key = (k: string, mods: Partial<TermKeyEvent> = {}): TermKeyEvent => ({
  type: 'keydown',
  key: k,
  code: k.length === 1 ? `Key${k.toUpperCase()}` : k,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods
})
const state = (over: Partial<Parameters<typeof termKeyAction>[1]> = {}) => ({
  hasSelection: false,
  deleteSelection: () => false,
  hostOwns: () => false,
  agentHere: false,
  ...over
})

describe('a key over a shell', () => {
  it('Ctrl+C copies a selection and is the interrupt without one', () => {
    expect(termKeyAction(key('c', { ctrlKey: true }), state({ hasSelection: true }))).toBe('copy')
    expect(termKeyAction(key('c', { ctrlKey: true }), state())).toBe('xterm')
  })
  it('reads the PHYSICAL key: Ctrl+C on a Russian layout still copies (rule 11)', () => {
    expect(termKeyAction(key('с', { ctrlKey: true, code: 'KeyC' }), state({ hasSelection: true }))).toBe('copy')
    expect(termKeyAction(key('м', { ctrlKey: true, code: 'KeyV' }), state())).toBe('paste')
  })
  it('Backspace deletes a selection only when the edited line takes it', () => {
    const del = vi.fn(() => true)
    expect(termKeyAction(key('Backspace'), state({ hasSelection: true, deleteSelection: del }))).toBe('deleted')
    expect(termKeyAction(key('Backspace'), state({ hasSelection: true }))).toBe('xterm')
    expect(termKeyAction(key('Backspace'), state({ deleteSelection: del }))).toBe('xterm')
    expect(del).toHaveBeenCalledTimes(1)
  })
  it("the host's chords never reach xterm", () => {
    expect(termKeyAction(key('t', { ctrlKey: true }), state({ hostOwns: () => true }))).toBe('host')
  })
  it('Shift+Enter is a newline only where an agent runs (#21)', () => {
    expect(termKeyAction(key('Enter', { shiftKey: true }), state({ agentHere: true }))).toBe('newline')
    expect(termKeyAction(key('Enter', { shiftKey: true }), state())).toBe('xterm')
  })
  it('Ctrl+V is the one paste, Ctrl+Shift+V the plain one; keyup is xterm\'s', () => {
    expect(termKeyAction(key('v', { ctrlKey: true }), state())).toBe('paste')
    expect(termKeyAction(key('V', { ctrlKey: true, shiftKey: true }), state())).toBe('paste-plain')
    expect(termKeyAction({ ...key('v', { ctrlKey: true }), type: 'keyup' }, state())).toBe('xterm')
  })
})
