import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement, type JSX } from 'react'
import { plusButtonMenu, tabContextMenu } from './tabStrip'

// The unit tests run under node, where `window` does not exist; in a browser
// it IS globalThis (see fileVerbs.test.ts).
if (typeof window === 'undefined')
  Object.defineProperty(globalThis, 'window', { value: globalThis })

afterEach(() => {
  delete (globalThis as unknown as { prism?: unknown }).prism
})

const labels = (items: Array<{ label: string }>): string[] => items.map((i) => i.label)

describe('tabContextMenu', () => {
  it('a folder tab: close, then the folder rows', () => {
    const showInExplorer = vi.fn()
    ;(globalThis as unknown as { prism: unknown }).prism = { showInExplorer }
    const items = tabContextMenu({ root: 'C:\\a', pinned: false, onClose: vi.fn() })
    expect(labels(items)).toEqual(['Close tab', 'Show folder in File Explorer', 'Copy folder path'])
    items[1].onPick?.()
    expect(showInExplorer).toHaveBeenCalledWith('C:\\a')
  })
  it('a pinned Explorer tab cannot be closed', () => {
    expect(labels(tabContextMenu({ root: 'C:\\a', pinned: true, onClose: vi.fn() }))).toEqual([
      'Show folder in File Explorer',
      'Copy folder path'
    ])
  })
  it('Settings has no folder: only Close tab', () => {
    expect(labels(tabContextMenu({ root: '', pinned: false, onClose: vi.fn() }))).toEqual([
      'Close tab'
    ])
  })
})

describe('plusButtonMenu', () => {
  const pinIcon = (filled: boolean): JSX.Element => createElement('i', { 'data-filled': filled })
  it('lists the places, with a pin on each', () => {
    const onOpenRecent = vi.fn()
    const onTogglePin = vi.fn()
    const items = plusButtonMenu({
      rows: [
        { path: 'C:\\work\\one', pinned: true },
        { path: 'C:\\two', pinned: false }
      ],
      onOpenRecent,
      onTogglePin,
      pinIcon
    })
    expect(labels(items)).toEqual(['one', 'two'])
    expect(items.map((i) => i.trailing?.title)).toEqual(['Unpin', 'Pin to this menu'])
    items[1].onPick?.()
    expect(onOpenRecent).toHaveBeenCalledWith('C:\\two')
    items[0].trailing?.onClick()
    expect(onTogglePin).toHaveBeenCalledWith('C:\\work\\one')
  })
  it('two folders of one name carry their parent', () => {
    const items = plusButtonMenu({
      rows: [
        { path: 'C:\\a\\src', pinned: false },
        { path: 'C:\\b\\src', pinned: false }
      ],
      onOpenRecent: vi.fn(),
      onTogglePin: vi.fn(),
      pinIcon
    })
    expect(labels(items)).toEqual(['src  \u00b7  a', 'src  \u00b7  b'])
  })
  it('with no history it says so, disabled', () => {
    const items = plusButtonMenu({
      rows: [],
      onOpenRecent: vi.fn(),
      onTogglePin: vi.fn(),
      pinIcon
    })
    expect(items).toEqual([{ label: 'No recent folders', disabled: true }])
  })
})
