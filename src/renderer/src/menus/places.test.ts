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
const a = folder('C:\\a')
const b = folder('C:\\b')
const c = folder('C:\\c')

const build = (over: Partial<PlacesMenuContext> = {}): ReturnType<typeof placesMenu> =>
  placesMenu({
    pin: b,
    pinned: true,
    siblings: [a, b, c],
    index: 1,
    onChoose: vi.fn(),
    onNavigate: vi.fn(),
    onQuickAccessFile: vi.fn(),
    onOpenNewTab: vi.fn(),
    onOpenProject: vi.fn(),
    onUnpinQuickAccess: vi.fn(),
    onProperties: vi.fn(),
    onMoveQuickAccess: vi.fn(),
    onPinQuickAccessPaths: vi.fn(),
    ...over
  })
const labels = (items: ReturnType<typeof placesMenu>): string[] => items.map((i) => i.label)
const disabled = (items: ReturnType<typeof placesMenu>): string[] =>
  items.filter((i) => i.disabled).map((i) => i.label)

const PIN_ROWS = ['Unpin from Quick access', 'Move up', 'Move down']

describe('placesMenu', () => {
  it('a pinned folder (Quick access or Pinned) has the pin rows', () => {
    expect(labels(build())).toEqual([
      'Open',
      'Open in new tab',
      'Open as project',
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
    const items = build({ pin: file, siblings: [file], index: 0, onQuickAccessFile, onNavigate })
    expect(labels(items)).toEqual([
      'Open',
      'Open in new tab',
      'Open as project',
      'Copy path',
      ...PIN_ROWS,
      'Show in File Explorer',
      'Properties'
    ])
    items[0].onPick?.()
    expect(onQuickAccessFile).toHaveBeenCalledWith('C:\\b.txt', true)
    expect(onNavigate).not.toHaveBeenCalled()
  })
  it('a Projects row or drive that is not pinned offers the pin instead', () => {
    const items = build({ pin: folder('D:\\'), pinned: false, index: -1 })
    expect(labels(items)).toEqual([
      'Open',
      'Open in new tab',
      'Open as project',
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
  it('the first row cannot move up, the last cannot move down', () => {
    expect(disabled(build({ pin: a, index: 0 }))).toEqual(['Move up'])
    expect(disabled(build({ pin: c, index: 2 }))).toEqual(['Move down'])
  })
  it('a pinned place missing from its section list (index -1) cannot move', () => {
    expect(disabled(build({ index: -1 }))).toEqual(['Move up', 'Move down'])
  })
  it('moves land before the row above, or before the row after next', () => {
    const onMoveQuickAccess = vi.fn()
    const items = build({ onMoveQuickAccess })
    items.find((i) => i.label === 'Move up')?.onPick?.()
    expect(onMoveQuickAccess).toHaveBeenLastCalledWith('C:\\b', 'C:\\a')
    items.find((i) => i.label === 'Move down')?.onPick?.()
    expect(onMoveQuickAccess).toHaveBeenLastCalledWith('C:\\b', undefined)
  })
  it('a missing action leaves its row disabled', () => {
    expect(
      disabled(
        build({
          onOpenNewTab: undefined,
          onOpenProject: undefined,
          onUnpinQuickAccess: undefined,
          onMoveQuickAccess: undefined
        })
      )
    ).toEqual(['Open in new tab', 'Open as project', ...PIN_ROWS])
    expect(disabled(build({ pinned: false, onPinQuickAccessPaths: undefined }))).toEqual([
      'Pin to Quick access'
    ])
  })
})
