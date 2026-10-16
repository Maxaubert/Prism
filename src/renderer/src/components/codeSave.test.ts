import { describe, expect, it } from 'vitest'
import { landSave, saveTarget } from './codeSave'

describe('saveTarget (2026-10-16)', () => {
  it('writes the file the editor is showing, to the path its text came from', () => {
    expect(saveTarget('C:\\b.txt', 'C:\\b.txt', { path: 'C:\\b.txt' })).toBe('C:\\b.txt')
  })

  it('refuses while the next file is still loading: the editor holds the old text', () => {
    // path is B already; the read has not landed, so the view and `saved` are A's.
    expect(saveTarget('C:\\b.txt', 'C:\\a.txt', { path: 'C:\\a.txt' })).toBeNull()
  })

  it('refuses when the remembered disk text is another file\'s', () => {
    expect(saveTarget('C:\\b.txt', 'C:\\b.txt', { path: 'C:\\a.txt' })).toBeNull()
  })

  it('refuses a file that never loaded', () => {
    expect(saveTarget('C:\\b.txt', 'C:\\b.txt', null)).toBeNull()
  })
})

describe('landSave (2026-10-16)', () => {
  const never = (): string => {
    throw new Error('the editor holds another file now')
  }

  it('reports clean when the document is what was written', () => {
    expect(landSave('a', 'a', 'x', () => 'x', () => undefined)).toEqual({ here: true, buffer: null })
  })

  it('keeps typing done during the save as unsaved', () => {
    expect(landSave('a', 'a', 'x', () => 'xy', () => undefined)).toEqual({ here: true, buffer: 'xy' })
  })

  it('never reads the editor once the user has moved to another file', () => {
    expect(landSave('a', 'b', 'x', never, () => 'x')).toEqual({ here: false, clear: true })
  })

  it('leaves the saved file dirty if more was typed before leaving it', () => {
    expect(landSave('a', 'b', 'x', never, () => 'xy')).toEqual({ here: false, clear: false })
  })
})
