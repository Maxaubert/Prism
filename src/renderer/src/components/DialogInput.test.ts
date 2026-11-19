import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DIALOG_INPUT } from 'prism-term-core/renderer/components/dialogLook'
import { fieldHasFocus } from 'prism-term-core/renderer/components/Modal'
import { BrowseRename } from './browse/BrowseRename'
import { DialogInput } from './DialogInput'
import { dialogInputKey } from './dialogInputKeys'
import { PasswordDialog } from '../dialogs/PasswordDialog'

const key = (k: string) => ({ key: k, stopPropagation: vi.fn(), preventDefault: vi.fn() })

describe('DialogInput (#516)', () => {
  it('stops every key, and answers Enter only when allowed', () => {
    const answer = vi.fn()
    const a = key('a')
    expect(dialogInputKey(a, true, answer)).toBe(false)
    expect(a.stopPropagation).toHaveBeenCalled()
    const empty = key('Enter')
    expect(dialogInputKey(empty, false, answer)).toBe(true)
    expect(answer).not.toHaveBeenCalled()
    dialogInputKey(key('Enter'), true, answer)
    expect(answer).toHaveBeenCalledTimes(1)
  })

  it('wears the one dialog field look, in every dialog that has a field', () => {
    const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el)
    const pw = html(createElement(PasswordDialog, { name: 'a.zip', wrong: false, onSubmit: () => {}, onCancel: () => {} }))
    const rn = html(createElement(BrowseRename, { name: 'a.txt', onSave: () => {}, onCancel: () => {} }))
    const own = html(createElement(DialogInput, { value: '', onChange: () => {} }))
    for (const h of [pw, rn, own]) expect(h).toContain(DIALOG_INPUT)
  })

  it('the Modal leaves a focused field alone', () => {
    const box = { contains: (n: unknown) => n === field || n === button }
    const field = { tagName: 'INPUT' }
    const button = { tagName: 'BUTTON' }
    expect(fieldHasFocus(box, field)).toBe(true)
    expect(fieldHasFocus(box, button)).toBe(false)
    expect(fieldHasFocus(box, { tagName: 'INPUT' })).toBe(false)
    expect(fieldHasFocus(box, null)).toBe(false)
  })
})