import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { PasswordDialog } from './PasswordDialog'
import { plain } from './testing'

// It holds the typed value in state, so it is rendered rather than called.
const text = (wrong: boolean): string =>
  plain(createElement(PasswordDialog, { name: 'a.zip', wrong, onSubmit: () => {}, onCancel: () => {} }))

describe('PasswordDialog', () => {
  it('asks for the password, then says it was wrong', () => {
    expect(text(false)).toContain('This archive is password protected')
    expect(text(false)).toContain('Enter the password to open "a.zip":')
    expect(text(true)).toContain(`That password didn't open "a.zip". Try again:`)
  })

  it('offers Cancel, then Unlock', () => {
    const t = text(false)
    expect(t.indexOf('Cancel')).toBeLessThan(t.indexOf('Unlock'))
  })
})
