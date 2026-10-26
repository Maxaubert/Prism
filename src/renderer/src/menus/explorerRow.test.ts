import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowseEntry } from '../components/browse/types'
import { explorerRowMenu, type ExplorerRowMenuContext } from './explorerRow'
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

const file: BrowseEntry = { path: 'C:\\a\\b.txt', name: 'b.txt', isFolder: false }
const folder: BrowseEntry = { path: 'C:\\a\\c', name: 'c', isFolder: true }

const menu = (over: Partial<ExplorerRowMenuContext>): ExplorerRowMenuContext => ({
  entry: file,
  pinned: false,
  openFolder: vi.fn(),
  openFile: vi.fn(),
  showInPreview: vi.fn(),
  openInNewTab: vi.fn(),
  openAsProject: vi.fn(),
  copyFiles: vi.fn(),
  paste: vi.fn(),
  pinQuickAccess: vi.fn(),
  unpinQuickAccess: vi.fn(),
  duplicate: vi.fn(),
  rename: vi.fn(),
  askDelete: vi.fn(),
  askDeleteMany: vi.fn(),
  properties: vi.fn(),
  ...over
})

const labels = (ctx: ExplorerRowMenuContext): string[] => explorerRowMenu(ctx).map((i) => i.label)

describe('explorerRowMenu', () => {
  it('a file row', () => {
    expect(labels(menu({ entry: file }))).toEqual([
      'Open',
      'Show in preview',
      'Open in new tab',
      'Open as project',
      'Open in',
      'Cut',
      'Copy',
      'Copy path',
      'Paste',
      'Pin to Quick access',
      'Duplicate',
      'Rename',
      'Show in File Explorer',
      'Properties',
      'Delete'
    ])
  })
  it('a folder row', () => {
    expect(labels(menu({ entry: folder }))).toEqual([
      'Open',
      'Open in new tab',
      'Open as project',
      'Cut',
      'Copy',
      'Copy path',
      'Paste',
      'Pin to Quick access',
      'Rename',
      'Show in File Explorer',
      'Properties',
      'Delete'
    ])
  })
  it('a pinned row offers Unpin', () => {
    const items = explorerRowMenu(menu({ entry: folder, pinned: true }))
    const row = items.find((i) => i.label === 'Unpin from Quick access')
    expect(row).toBeDefined()
    row?.onPick?.()
  })
  it('Paste is greyed until the clipboard holds files', () => {
    const paste = (ctx: ExplorerRowMenuContext): boolean | undefined =>
      explorerRowMenu(ctx).find((i) => i.label === 'Paste')?.disabled
    expect(paste(menu({}))).toBe(true)
    expect(paste(menu({ canPaste: false }))).toBe(true)
    expect(paste(menu({ canPaste: true }))).toBe(false)
  })
  it('Paste into a file row lands in its folder', () => {
    const ctx = menu({ entry: file, canPaste: true })
    explorerRowMenu(ctx)
      .find((i) => i.label === 'Paste')
      ?.onPick?.()
    expect(ctx.paste).toHaveBeenCalledWith('C:\\a')
  })
  it('several marked rows', () => {
    const ctx = menu({ paths: ['C:\\a\\x', 'C:\\a\\y', 'C:\\a\\z'] })
    const items = explorerRowMenu(ctx)
    expect(items.map((i) => i.label)).toEqual(['Cut 3 items', 'Copy 3 items', 'Delete 3 items'])
    expect(items[2].danger).toBe(true)
  })
  it('one marked path is the single-row menu', () => {
    expect(labels(menu({ entry: folder, paths: [folder.path] }))[0]).toBe('Open')
  })
})
