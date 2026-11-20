import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PhoneDialog } from '../components/PhoneDialog'
import { Dialog, DialogFooter, closeOnly } from '../components/Dialog'
import { ArchiveFactsDialog } from './ArchiveFactsDialog'
import { NoticeDialog } from './NoticeDialog'
import { labels, specOf } from './testing'

// ONE FOOTER, ONE LABEL (owner, 2026-11-19, #520): a dialog that has nothing
// to answer says Close, and every footer is the one DialogFooter.
describe('the close-only dialogs', () => {
  it('say Close, as the one primary button', () => {
    const onClose = vi.fn()
    for (const el of [
      NoticeDialog({ title: 'a', message: 'b', onClose }),
      ArchiveFactsDialog({ name: 'a', lines: [], onClose })
    ]) {
      const s = specOf(el)
      expect(labels(s)).toEqual(['Close'])
      expect(s.choices[0].primary).toBe(true)
    }
  })
  it('the phone window says Close too', () => {
    Object.defineProperty(globalThis, 'window', {
      value: { prism: { phoneGet: () => new Promise(() => {}), onPhoneChanged: () => () => {}, phoneCodeDrop: () => {} } },
      configurable: true
    })
    const out = renderToStaticMarkup(createElement(PhoneDialog, { start: null, onClose: () => {} }))
    expect([...out.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => m[1])).toEqual(['Close'])
  })
  it('closeOnly closes', () => {
    const onClose = vi.fn()
    closeOnly(onClose)[0].onPick()
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('DialogFooter', () => {
  const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el)
  it('is 20px under the body, buttons on the right, the primary marked', () => {
    const out = html(createElement(DialogFooter, { choices: closeOnly(() => {}) }))
    expect(out).toContain('mt-5 flex items-center justify-end gap-2')
    expect(out).toContain('data-primary="true"')
    expect(out).not.toContain('mt-[18px]')
  })
  it('puts left buttons at the left edge', () => {
    const out = html(createElement(DialogFooter, { choices: closeOnly(() => {}), left: createElement('i', null, 'L') }))
    expect(out).toContain('mr-auto')
  })
  it('a Dialog with no choices draws no footer, one without a title draws no heading', () => {
    const out = html(createElement(Dialog, { label: 'x', body: createElement('p', null, 'hi'), onCancel: () => {} }))
    expect(out).not.toContain('<h2')
    expect(out).not.toContain('<button')
  })
})