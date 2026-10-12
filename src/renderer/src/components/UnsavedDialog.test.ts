import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { UnsavedDialog } from './UnsavedDialog'

// One question for every route that strands typed text (closing, installing,
// closing a tab, re-rooting it). Its copy is pinned here; the e2e `unsaved`
// and `updateGuard` click through it.

const text = (names: string[], consequence = 'Closing without saving throws them away.'): string =>
  renderToStaticMarkup(
    createElement(UnsavedDialog, {
      names,
      consequence,
      onCancel: () => {},
      onDiscard: () => {},
      onSave: () => {}
    })
  ).replace(/<[^>]+>/g, '')

describe('UnsavedDialog', () => {
  it('names one file and says what going on costs', () => {
    const t = text(['notes.txt'])
    expect(t).toContain('Unsaved changes')
    expect(t).toContain('notes.txt has changes that are not on disk yet. Closing without saving throws them away.')
  })

  it('counts several', () => {
    const t = text(['a.txt', 'b.txt'], 'Closing this folder is the last way back to them.')
    expect(t).toContain('2 files have unsaved changes')
    expect(t).toContain('a.txt, b.txt are not on disk yet. Closing this folder is the last way back to them.')
  })

  it('falls back to "This file" and offers the three answers in order', () => {
    const t = text([])
    expect(t).toContain('This file has changes')
    expect(t.indexOf('Cancel')).toBeLessThan(t.indexOf('Discard'))
    expect(t.indexOf('Discard')).toBeLessThan(t.indexOf('Save all changes'))
  })
})
