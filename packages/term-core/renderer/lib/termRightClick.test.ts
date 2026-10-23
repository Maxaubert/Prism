import { describe, expect, it } from 'vitest'
import { keepRightClick, type RightClickGate } from './termRightClick'

const at = (g: Partial<RightClickGate>): boolean =>
  keepRightClick({ type: 'mousedown', button: 2, buttons: 2, mouseTracking: 'vt200', sendRight: false, ...g })

// Flare #49: a_right_click_in_mouse_mode_opens_the_menu_and_sends_nothing,
// with_the_setting_on_a_right_press_is_reported_unless_a_selection_stands.
describe('a right-click in a program that reads the mouse', () => {
  it('keeps the press and the release from the program by default', () => {
    expect(at({ type: 'mousedown' })).toBe(true)
    expect(at({ type: 'mouseup', buttons: 0 })).toBe(true)
    for (const mode of ['x10', 'vt200', 'drag', 'any']) expect(at({ mouseTracking: mode }), mode).toBe(true)
  })

  it('keeps a move made while the right button is held, not any other', () => {
    expect(at({ type: 'mousemove', button: 0, buttons: 2 })).toBe(true)
    expect(at({ type: 'mousemove', button: 0, buttons: 3 })).toBe(true)
    expect(at({ type: 'mousemove', button: 0, buttons: 1 })).toBe(false)
    expect(at({ type: 'mousemove', button: 0, buttons: 0 })).toBe(false)
  })

  it('never touches the left or middle button', () => {
    expect(at({ button: 0, buttons: 1 })).toBe(false)
    expect(at({ type: 'mouseup', button: 0, buttons: 0 })).toBe(false)
    expect(at({ button: 1, buttons: 4 })).toBe(false)
    expect(at({ type: 'wheel', button: 0, buttons: 0 })).toBe(false)
  })

  it('lets everything through with "Send right clicks to programs" on', () => {
    expect(at({ sendRight: true })).toBe(false)
    expect(at({ type: 'mouseup', sendRight: true })).toBe(false)
    expect(at({ type: 'mousemove', button: 0, sendRight: true })).toBe(false)
  })

  it('leaves xterm alone where no program has the mouse', () => {
    expect(at({ mouseTracking: 'none' })).toBe(false)
    expect(at({ type: 'mouseup', mouseTracking: 'none' })).toBe(false)
  })
})
