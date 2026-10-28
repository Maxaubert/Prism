import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement, type JSX } from 'react'
import { plusButtonMenu, tabContextMenu } from './tabStrip'
import { aliasWindow, clearHost, setHost } from '../testing/host'

aliasWindow()

afterEach(clearHost)

const labels = (items: Array<{ label: string }>): string[] => items.map((i) => i.label)

describe('tabContextMenu', () => {
  it('a folder tab: the folder rows, then close, last', () => {
    const showInExplorer = vi.fn()
    setHost({ showInExplorer })
    const items = tabContextMenu({ root: 'C:\\a', onClose: vi.fn() })
    expect(labels(items)).toEqual(['Copy folder path', 'Show folder in File Explorer', 'Close tab'])
    items[1].onPick?.()
    expect(showInExplorer).toHaveBeenCalledWith('C:\\a')
  })
  it('Settings has no folder: only Close tab', () => {
    expect(labels(tabContextMenu({ root: '', onClose: vi.fn() }))).toEqual([
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
