import { describe, expect, it } from 'vitest'
import { DIALOG_BOX, dialogBox, dialogButton } from './dialogLook'

// ONE DIALOG BUTTON, ONE BOX (#514). The update window wrote its own buttons
// (with focus rings, against #272), the disabled look was 45, 50 or 55 percent,
// and two callers patched class strings with .replace().

describe('dialogBox', () => {
  it('takes a width and a padding, and the default is the 420 box', () => {
    expect(DIALOG_BOX).toBe(dialogBox())
    expect(dialogBox()).toContain(' max-w-[420px] ')
    expect(dialogBox()).toContain(' p-5 ')
    expect(dialogBox({ width: 520 })).toContain(' max-w-[520px] ')
    expect(dialogBox({ width: 456, pad: 'sheet' })).toContain(' px-[22px] py-5 ')
    expect(dialogBox({ width: 580, pad: 'roomy' })).toMatch(/ max-w-\[580px\] .* p-7 /)
  })
  it('keeps the box positioned (the magnifier follows a caret in it)', () => {
    expect(dialogBox({ width: 580 }).startsWith('relative ')).toBe(true)
  })
})

describe('dialogButton', () => {
  it('has a disabled state: 45 percent, no pointer, no hover', () => {
    for (const c of [{}, { primary: true }, { danger: true }, { selected: true }]) {
      const s = dialogButton(c)
      expect(s, JSON.stringify(c)).toContain('disabled:opacity-45')
      expect(s).toContain('disabled:cursor-default')
      expect(s).toMatch(/disabled:hover:(brightness-100|text-)/)
    }
  })
  it('has a selected variant in --p-sel-bg and a primary one in --p-accent', () => {
    expect(dialogButton({ selected: true })).toContain('bg-[var(--p-sel-bg)]')
    expect(dialogButton({ selected: true })).not.toContain('bg-[var(--p-accent)]')
    expect(dialogButton({ primary: true })).toContain('bg-[var(--p-accent)]')
  })
  it('never carries a focus ring (#272)', () => {
    for (const c of [{}, { primary: true }, { danger: true }, { selected: true }, { compact: true }]) {
      expect(dialogButton(c)).not.toMatch(/ring/)
      expect(dialogButton(c)).toContain('focus-visible:outline-none')
    }
  })
  it('a compact one is the row control', () => {
    expect(dialogButton({ compact: true })).toContain('px-2.5 py-1 leading-none')
    expect(dialogButton({})).toContain('px-3.5 py-1.5')
  })
})
