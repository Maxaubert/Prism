import { describe, expect, it } from 'vitest'
import { folderKeyAction, type FolderKeyContext, type FolderKeyEvent } from './folderKeys'

const ev = (key: string, mods: Partial<FolderKeyEvent> = {}): FolderKeyEvent => ({
  key,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods
})
const ctx = (over: Partial<FolderKeyContext> = {}): FolderKeyContext => ({
  typing: false,
  inList: true,
  common: null,
  hasSelected: true,
  many: false,
  bin: false,
  hasRefresh: true,
  hasDelete: true,
  hasRename: true,
  inOwnFind: false,
  ...over
})

describe('folderKeyAction', () => {
  it('a common folder key wins over everything else', () => {
    expect(folderKeyAction(ev('F5'), ctx({ common: 'bin' }))).toBe('common')
    expect(folderKeyAction(ev('x'), ctx({ common: 'unknown' }))).toBeNull()
  })
  it('F5 needs a refresh handler', () => {
    expect(folderKeyAction(ev('F5'), ctx())).toBe('refresh')
    expect(folderKeyAction(ev('F5'), ctx({ hasRefresh: false }))).toBeNull()
  })
  it('plain Delete acts from the list on a selection, never with Ctrl or Shift', () => {
    expect(folderKeyAction(ev('Delete'), ctx())).toBe('delete')
    expect(folderKeyAction(ev('Delete'), ctx({ hasDelete: false }))).toBeNull()
    expect(folderKeyAction(ev('Delete'), ctx({ hasDelete: false, bin: true }))).toBe('delete')
    expect(folderKeyAction(ev('Delete', { shiftKey: true }), ctx())).toBeNull()
    expect(folderKeyAction(ev('Delete'), ctx({ typing: true }))).toBeNull()
    expect(folderKeyAction(ev('Delete'), ctx({ inList: false }))).toBeNull()
    expect(folderKeyAction(ev('Delete'), ctx({ hasSelected: false }))).toBeNull()
  })
  it('Ctrl+L edits the path, even while typing', () => {
    expect(folderKeyAction(ev('l', { ctrlKey: true }), ctx({ typing: true }))).toBe('edit-path')
    expect(folderKeyAction(ev('L', { ctrlKey: true, shiftKey: true }), ctx())).toBeNull()
  })
  it('Ctrl+F finds unless an editor keeps its own', () => {
    expect(folderKeyAction(ev('f', { ctrlKey: true }), ctx({ typing: true }))).toBe('find')
    expect(folderKeyAction(ev('f', { ctrlKey: true }), ctx({ inOwnFind: true }))).toBeNull()
    expect(folderKeyAction(ev('f', { ctrlKey: true, altKey: true }), ctx())).toBeNull()
  })
  it('Backspace goes back or up when not typing', () => {
    expect(folderKeyAction(ev('Backspace'), ctx())).toBe('back-or-up')
    expect(folderKeyAction(ev('Backspace'), ctx({ typing: true }))).toBeNull()
    expect(folderKeyAction(ev('Backspace', { ctrlKey: true }), ctx())).toBeNull()
  })
  it('Alt+arrows walk the history', () => {
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp']) {
      expect(folderKeyAction(ev(k, { altKey: true }), ctx())).toBe('history')
    }
    expect(folderKeyAction(ev('ArrowDown', { altKey: true }), ctx())).toBeNull()
    expect(folderKeyAction(ev('ArrowLeft'), ctx())).toBeNull()
  })
  it('F2 renames one selected row outside the bin', () => {
    expect(folderKeyAction(ev('F2'), ctx())).toBe('rename')
    expect(folderKeyAction(ev('F2'), ctx({ many: true }))).toBeNull()
    expect(folderKeyAction(ev('F2'), ctx({ bin: true }))).toBeNull()
    expect(folderKeyAction(ev('F2'), ctx({ hasRename: false }))).toBeNull()
  })
  it('Ctrl+C, X and V are the clipboard keys from the list only', () => {
    for (const k of ['c', 'X', 'v']) expect(folderKeyAction(ev(k, { ctrlKey: true }), ctx())).toBe('clipboard')
    expect(folderKeyAction(ev('c', { ctrlKey: true, shiftKey: true }), ctx())).toBeNull()
    expect(folderKeyAction(ev('c', { ctrlKey: true }), ctx({ inList: false }))).toBeNull()
    expect(folderKeyAction(ev('a', { ctrlKey: true }), ctx())).toBeNull()
  })
})