import { describe, expect, it } from 'vitest'
import { tapVerb } from './tapChrome'

describe('a tap on the picture', () => {
  it('reveals the chrome when it is hidden, and only then', () => {
    expect(tapVerb('touch', false)).toBe('reveal')
    expect(tapVerb('touch', true)).toBe('toggle')
  })

  it('treats a pen as a finger, which is what the comic already does', () => {
    expect(tapVerb('pen', false)).toBe('reveal')
    expect(tapVerb('pen', true)).toBe('toggle')
  })

  it('leaves the mouse exactly as the desktop has always had it', () => {
    expect(tapVerb('mouse', false)).toBe('toggle')
    expect(tapVerb('mouse', true)).toBe('toggle')
  })

  it('reads an unknown pointer as a mouse, so nothing off the touch path moves', () => {
    // A click with no pointer behind it at all - Enter on a focused element,
    // a synthetic click from a test - must do what it did before this rule
    // existed, which is toggle.
    expect(tapVerb('', false)).toBe('toggle')
    expect(tapVerb(undefined, false)).toBe('toggle')
  })
})
