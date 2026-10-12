import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuItem } from '../components/ContextMenu'
import { treeDeadSpaceMenu, treeMarkedMenu, treeRowMenu, type TreeRowMenuContext } from './treeRow'
import { aliasWindow, clearHost, fakeClipboard, setHost } from '../testing/host'

aliasWindow()

let showInExplorer: ReturnType<typeof vi.fn>
let duplicateFile: ReturnType<typeof vi.fn>
let writeText: ReturnType<typeof vi.fn>
beforeEach(() => {
  showInExplorer = vi.fn()
  duplicateFile = vi.fn(() => Promise.resolve('C:\\p\\a - Copy.txt'))
  setHost({ showInExplorer, duplicateFile })
  writeText = vi.fn(() => Promise.resolve())
  fakeClipboard(writeText)
})
afterEach(clearHost)

const labels = (items: MenuItem[]): string[] => items.map((i) => i.label)
const row = (items: MenuItem[], label: string): MenuItem => {
  const it = items.find((i) => i.label === label)
  if (!it) throw new Error(`no row "${label}"`)
  return it
}

const rowCtx = (over: Partial<TreeRowMenuContext> = {}): TreeRowMenuContext => ({
  path: 'C:\\p\\a.txt',
  name: 'a.txt',
  isFolder: false,
  size: 2048,
  apps: [],
  arc: undefined,
  canPaste: false,
  pinnedPaths: [],
  searching: false,
  expanded: false,
  revealFolder: vi.fn(),
  toggle: vi.fn(),
  openFile: vi.fn(),
  onOpenNewTab: vi.fn(),
  onOpenProject: vi.fn(),
  pinSplit: vi.fn(),
  unpinSplit: vi.fn(),
  copyMark: vi.fn(),
  paste: vi.fn(),
  termHere: vi.fn(),
  extract: vi.fn(),
  addToArchive: vi.fn(),
  onDuplicated: vi.fn(),
  reload: vi.fn(),
  rename: vi.fn(),
  showProperties: vi.fn(),
  onDelete: vi.fn(),
  ...over
})

describe('treeRowMenu', () => {
  it('a file row', () => {
    const items = treeRowMenu(rowCtx())
    expect(labels(items)).toEqual([
      'Open',
      'Open in new tab',
      'Open as project',
      'Open in split view',
      'Open in',
      'Cut',
      'Copy',
      'Copy path',
      'Duplicate',
      'Rename',
      'Show in File Explorer',
      'Properties',
      'Delete'
    ])
    expect(labels(row(items, 'Open in split view').children!)).toEqual([
      'Left',
      'Right',
      'Top',
      'Bottom'
    ])
    expect(row(items, 'Properties').hint).toBe('2.0 KB')
    expect(row(items, 'Delete').danger).toBe(true)
  })

  it('a pinned file row offers the way out of the split', () => {
    const ctx = rowCtx({ pinnedPaths: ['c:\\P\\A.TXT'] })
    const items = treeRowMenu(ctx)
    expect(labels(items).slice(3, 5)).toEqual(['Remove from split view', 'Open in'])
    row(items, 'Remove from split view').onPick?.()
    expect(ctx.unpinSplit).toHaveBeenCalledWith('C:\\p\\a.txt')
  })

  it('a folder row', () => {
    const items = treeRowMenu(
      rowCtx({ path: 'C:\\p\\d', name: 'd', isFolder: true, size: undefined, apps: undefined })
    )
    expect(labels(items)).toEqual([
      'Open',
      'Open in new tab',
      'Open as project',
      'New terminal here',
      'Cut',
      'Copy',
      'Copy path',
      'Rename',
      'Show in File Explorer',
      'Properties',
      'Delete'
    ])
    expect(row(items, 'Properties').hint).toBeUndefined()
  })

  it("Paste appears once the clipboard holds files, into the file row's folder", () => {
    const ctx = rowCtx({ canPaste: true })
    const items = treeRowMenu(ctx)
    expect(labels(items).slice(5, 9)).toEqual(['Cut', 'Copy', 'Copy path', 'Paste'])
    row(items, 'Paste').onPick?.()
    expect(ctx.paste).toHaveBeenCalledWith('C:\\p')
  })

  it('a writable archive row', () => {
    const items = treeRowMenu(rowCtx({ path: 'C:\\p\\z.zip', name: 'z.zip', arc: { write: true } }))
    expect(labels(items).slice(5)).toEqual([
      'Cut',
      'Copy',
      'Copy path',
      'Extract here',
      'Extract to…',
      'Add files…',
      'Duplicate',
      'Rename',
      'Show in File Explorer',
      'Properties',
      'Delete'
    ])
  })

  it('a read-only archive row, and one whose stat is in flight', () => {
    for (const arc of [{ write: false }, null]) {
      const items = treeRowMenu(rowCtx({ path: 'C:\\p\\z.7z', name: 'z.7z', arc }))
      expect(labels(items).slice(8, 11)).toEqual(['Extract here', 'Extract to…', 'Duplicate'])
    }
  })

  it('Open: a file opens, a folder expands, a search reveals', () => {
    const file = rowCtx()
    row(treeRowMenu(file), 'Open').onPick?.()
    expect(file.openFile).toHaveBeenCalledWith('C:\\p\\a.txt')

    const folder = rowCtx({ path: 'C:\\p\\d', isFolder: true })
    row(treeRowMenu(folder), 'Open').onPick?.()
    expect(folder.toggle).toHaveBeenCalledWith('C:\\p\\d')

    const open = rowCtx({ path: 'C:\\p\\d', isFolder: true, expanded: true })
    row(treeRowMenu(open), 'Open').onPick?.()
    expect(open.toggle).not.toHaveBeenCalled()

    const found = rowCtx({ path: 'C:\\p\\d', isFolder: true, searching: true })
    row(treeRowMenu(found), 'Open').onPick?.()
    expect(found.revealFolder).toHaveBeenCalledWith('C:\\p\\d')
  })

  it('Duplicate records the copy and re-reads the folder', async () => {
    const ctx = rowCtx()
    row(treeRowMenu(ctx), 'Duplicate').onPick?.()
    await vi.waitFor(() => expect(ctx.reload).toHaveBeenCalledWith('C:\\p'))
    expect(ctx.onDuplicated).toHaveBeenCalledWith('C:\\p\\a.txt', 'C:\\p\\a - Copy.txt')
  })
})

describe('treeMarkedMenu', () => {
  it('several marked rows', () => {
    const paths = ['C:\\p\\a', 'C:\\p\\b', 'C:\\p\\c']
    const deleteMany = vi.fn()
    const items = treeMarkedMenu({ paths, copyMark: vi.fn(), deleteMany })
    expect(labels(items)).toEqual(['Cut 3 files', 'Copy 3 files', 'Copy paths', 'Delete 3 items'])
    items[2].onPick?.()
    expect(writeText).toHaveBeenCalledWith('C:\\p\\a\nC:\\p\\b\nC:\\p\\c')
    items[3].onPick?.()
    expect(deleteMany).toHaveBeenCalledWith(paths)
  })
})

describe('treeDeadSpaceMenu', () => {
  it('the dead space acts on the root', () => {
    const paste = vi.fn()
    const showProperties = vi.fn()
    const items = treeDeadSpaceMenu({ root: 'C:\\p', paste, termHere: vi.fn(), showProperties })
    expect(labels(items)).toEqual([
      'Paste',
      'Copy path',
      'New terminal here',
      'Show in File Explorer',
      'Properties'
    ])
    items[0].onPick?.()
    expect(paste).toHaveBeenCalledWith('C:\\p')
    items[4].onPick?.()
    expect(showProperties).toHaveBeenCalledWith({ path: 'C:\\p', name: 'p', isFolder: true })
    items[3].onPick?.()
    expect(showInExplorer).toHaveBeenCalledWith('C:\\p')
  })
})
