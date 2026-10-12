import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuItem } from '../../components/ContextMenu'
import { codeMenu, type CodeMenuContext } from './code'
import { aliasWindow, clearHost, fakeClipboard, setHost } from '../../testing/host'

aliasWindow()

beforeEach(() => {
  setHost({
    capabilities: { write: true, clipboard: true, explorer: true, drag: true },
    showInExplorer: vi.fn()
  })
  fakeClipboard()
})
afterEach(clearHost)

const ctx = (over: Partial<CodeMenuContext> = {}): CodeMenuContext => ({
  path: 'C:\\src\\a.ts',
  readOnly: false,
  hasSel: true,
  wraps: false,
  setWrapPref: vi.fn(),
  ready: true,
  dirty: false,
  tailed: false,
  following: false,
  pasteHere: vi.fn(),
  selectAll: vi.fn(),
  findHere: vi.fn(),
  gotoHere: vi.fn(),
  toggleFollow: vi.fn(),
  save: vi.fn(() => Promise.resolve(true)),
  ...over
})
const labels = (items: MenuItem[]): string[] => items.map((i) => i.label)
const row = (items: MenuItem[], label: string): MenuItem => {
  const found = items.find((i) => i.label === label)
  if (!found) throw new Error(`no row "${label}"`)
  return found
}

describe('the editor menu', () => {
  it('an editable file with a selection', () => {
    const items = codeMenu(ctx())
    expect(labels(items)).toEqual([
      'Cut',
      'Copy',
      'Paste',
      'Copy path',
      'Select all',
      'Find',
      'Go to line',
      'Word wrap',
      'Follow the file',
      'Save',
      'Show in File Explorer'
    ])
    expect(row(items, 'Cut').disabled).toBe(false)
    expect(row(items, 'Follow the file').disabled).toBe(false)
    expect(row(items, 'Save').disabled).toBe(false)
  })

  it('greys Cut and Copy with nothing selected', () => {
    const items = codeMenu(ctx({ hasSel: false }))
    expect(row(items, 'Cut').disabled).toBe(true)
    expect(row(items, 'Copy').disabled).toBe(true)
  })

  it('refuses Follow while loading, with unsaved edits, or on a tail', () => {
    expect(row(codeMenu(ctx({ ready: false })), 'Follow the file').disabled).toBe(true)
    expect(row(codeMenu(ctx({ dirty: true })), 'Follow the file').disabled).toBe(true)
    expect(row(codeMenu(ctx({ tailed: true })), 'Follow the file').disabled).toBe(true)
  })

  it('refuses Save while following or on a tail', () => {
    expect(row(codeMenu(ctx({ following: true })), 'Save').disabled).toBe(true)
    expect(row(codeMenu(ctx({ tailed: true })), 'Save').disabled).toBe(true)
  })

  it('Word wrap flips the override', () => {
    const setWrapPref = vi.fn()
    row(codeMenu(ctx({ wraps: true, setWrapPref })), 'Word wrap').onPick?.()
    expect(setWrapPref).toHaveBeenCalledWith('off')
  })

  it("a reader's menu (#106): nothing that changes the document or the file", () => {
    const items = codeMenu(ctx({ readOnly: true }))
    expect(labels(items)).toEqual([
      'Copy',
      'Copy path',
      'Select all',
      'Find',
      'Go to line',
      'Word wrap',
      'Show in File Explorer'
    ])
    expect(row(codeMenu(ctx({ readOnly: true, hasSel: false })), 'Copy').disabled).toBe(true)
  })
})
