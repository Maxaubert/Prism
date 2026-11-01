import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { placesMenu, type PlacesMenuContext } from './places'
import type { QuickAccessPin } from '../lib/quickAccess'
import { aliasWindow, clearHost, fakeClipboard, setHost } from '../testing/host'

aliasWindow()

beforeEach(() => {
  setHost({
    capabilities: { write: true, clipboard: true, explorer: true, drag: true },
    showInExplorer: vi.fn()
  })
  fakeClipboard()
})
afterEach(clearHost)

const folder = (path: string): QuickAccessPin => ({ path, label: path, isFolder: true })
const b = folder('C:\\b')

const build = (over: Partial<PlacesMenuContext> = {}): ReturnType<typeof placesMenu> =>
  placesMenu({
    pin: b,
    pinned: true,
    onChoose: vi.fn(),
    onNavigate: vi.fn(),
    onQuickAccessFile: vi.fn(),
    onOpenNewTab: vi.fn(),
    onUnpinQuickAccess: vi.fn(),
    onProperties: vi.fn(),
    onPinQuickAccessPaths: vi.fn(),
    onChangeIcon: vi.fn(),
    ...over
  })
const labels = (items: ReturnType<typeof placesMenu>): string[] => items.map((i) => i.label)
const disabled = (items: ReturnType<typeof placesMenu>): string[] =>
  items.filter((i) => i.disabled).map((i) => i.label)

// A pin moves by dragging only (owner, 2026-10-31: "remove the move up down.
// rely on just dragging instead"), so the menu has no Move rows.
const PIN_ROWS = ['Unpin from Quick access', 'Change icon...']

describe('placesMenu', () => {
  it('a pinned folder (Quick access or Pinned) has the pin rows', () => {
    expect(labels(build())).toEqual([
      'Open',
      'Open in new tab',
      'Copy path',
      ...PIN_ROWS,
      'Show in File Explorer',
      'Properties'
    ])
    expect(disabled(build())).toEqual([])
  })
  it('a pinned FILE opens the file', () => {
    const onQuickAccessFile = vi.fn()
    const onNavigate = vi.fn()
    const file = { path: 'C:\\b.txt', label: 'b.txt', isFolder: false }
    const items = build({ pin: file, onQuickAccessFile, onNavigate })
    expect(labels(items)).toEqual([
      'Open',
      'Open in new tab',
      'Copy path',
      ...PIN_ROWS,
      'Show in File Explorer',
      'Properties'
    ])
    items[0].onPick?.()
    expect(onQuickAccessFile).toHaveBeenCalledWith('C:\\b.txt', true)
    expect(onNavigate).not.toHaveBeenCalled()
  })
  it('a drive that is not pinned offers the pin instead', () => {
    const items = build({ pin: folder('D:\\'), pinned: false, onChangeIcon: undefined })
    expect(labels(items)).toEqual([
      'Open',
      'Open in new tab',
      'Copy path',
      'Pin to Quick access',
      'Show in File Explorer',
      'Properties'
    ])
  })
  it('Open on a folder picks the place, then goes there', () => {
    const order: string[] = []
    const items = build({
      onChoose: () => order.push('choose'),
      onNavigate: (p) => order.push(`navigate ${p}`)
    })
    items[0].onPick?.()
    expect(order).toEqual(['choose', 'navigate C:\\b'])
  })
  it('no pin has Move up or Move down: pins reorder by dragging', () => {
    // Only a pinned place ever had Move rows, so the pinned menu is the one to pin.
    expect(labels(build()).filter((l) => /^Move /.test(l))).toEqual([])
  })
  it('a missing action leaves its row disabled', () => {
    expect(
      disabled(
        build({
          onOpenNewTab: undefined,
          onUnpinQuickAccess: undefined
        })
      )
    ).toEqual(['Open in new tab', 'Unpin from Quick access'])
    expect(disabled(build({ pinned: false, onPinQuickAccessPaths: undefined }))).toEqual([
      'Pin to Quick access'
    ])
  })
  it('Change icon... is a pin row option, and asks for that pin', () => {
    const onChangeIcon = vi.fn()
    build({ onChangeIcon })
      .find((i) => i.label === 'Change icon...')
      ?.onPick?.()
    expect(onChangeIcon).toHaveBeenCalledTimes(1)
    // A This PC drive's menu is given no onChangeIcon (BrowsePlaces).
    expect(labels(build({ onChangeIcon: undefined }))).not.toContain('Change icon...')
  })
})
