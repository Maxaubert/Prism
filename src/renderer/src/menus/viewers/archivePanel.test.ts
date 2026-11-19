import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuItem } from '../../components/ContextMenu'
import {
  archivePanelMenu,
  archiveRowMenu,
  type ArchiveMember,
  type ArchivePanelMenuContext,
  type ArchiveRowMenuContext
} from './archivePanel'
import { aliasWindow, clearHost, setHost } from '../../testing/host'

aliasWindow()

beforeEach(() => {
  setHost({
    capabilities: { write: true, clipboard: true, explorer: true, drag: true },
    showInExplorer: vi.fn()
  })
})
afterEach(clearHost)

const ALL = { clipboard: true, write: true, explorer: true }
const NONE = { clipboard: false, write: false, explorer: false }

// The archive: a folder "docs" holding two files, and a file beside it.
const FILES = ['docs/a.txt', 'docs/b.txt', 'readme.txt']
const docs: ArchiveMember = { path: 'docs', dir: true }
const readme: ArchiveMember = { path: 'readme.txt', dir: false }

const rowCtx = (
  over: Partial<ArchiveRowMenuContext<ArchiveMember>> = {}
): ArchiveRowMenuContext<ArchiveMember> => ({
  entry: readme,
  caps: ALL,
  writable: true,
  zip: 'w.zip',
  membersUnder: (folder) => FILES.filter((p) => p.startsWith(folder + '/')),
  filesOf: (paths) => paths.filter((p) => FILES.includes(p)),
  setCwd: vi.fn(),
  view: vi.fn(),
  copyOut: vi.fn(),
  copyFolder: vi.fn(),
  copyMany: vi.fn(),
  extractFolderHere: vi.fn(),
  extractMembers: vi.fn(),
  setEditing: vi.fn(),
  setConfirmDel: vi.fn(),
  setConfirmDelMany: vi.fn(),
  ...over
})
const labels = (items: MenuItem[]): string[] => items.map((i) => i.label)

import { archiveMenuRows } from '../archiveMenus'

describe('an archive member row', () => {
  it('a file member in a writable zip, in the table order', () => {
    expect(labels(archiveRowMenu(rowCtx()))).toEqual([
      'Open',
      'Extract this file',
      'Extract this file to…',
      'Copy file',
      'Rename',
      'Delete from archive'
    ])
  })

  it('the rows are the table rows, in its order, with its hints and danger mark', () => {
    const table = archiveMenuRows({ kind: 'file', writable: true, zip: 'w.zip' })
    const items = archiveRowMenu(rowCtx())
    // Show and Properties have no handler on a member here, so they drop out.
    const kept = table.filter((r) => r.id !== 'show' && r.id !== 'properties')
    expect(items.map((i) => [i.label, i.hint, i.danger])).toEqual(
      kept.map((r) => [r.label, r.hint, r.danger])
    )
  })

  it('a file member in a read-only container', () => {
    expect(labels(archiveRowMenu(rowCtx({ writable: false })))).toEqual([
      'Open',
      'Extract this file',
      'Extract this file to…',
      'Copy file'
    ])
  })

  it('a file member on the phone page: Open alone', () => {
    expect(labels(archiveRowMenu(rowCtx({ caps: NONE, writable: false })))).toEqual(['Open'])
  })

  it('every ellipsis is the one character', () => {
    const all = [
      ...archiveRowMenu(rowCtx()),
      ...archiveRowMenu(rowCtx({ entry: docs })),
      ...archivePanelMenu(panelCtx())
    ]
    expect(all.some((i) => i.label.includes('...'))).toBe(false)
    expect(labels(all)).toContain('Extract this file to…')
  })

  it('a folder member', () => {
    const items = archiveRowMenu(rowCtx({ entry: docs }))
    expect(labels(items)).toEqual([
      'Open',
      'Extract this folder',
      'Extract this folder to…',
      'Copy folder',
      'Delete from archive'
    ])
    expect(items.some((i) => i.disabled)).toBe(false)
  })

  it('a folder member deletes the files inside it', () => {
    const setConfirmDelMany = vi.fn()
    archiveRowMenu(rowCtx({ entry: docs, setConfirmDelMany })).at(-1)?.onPick?.()
    expect(setConfirmDelMany).toHaveBeenCalledWith(['docs/a.txt', 'docs/b.txt'])
  })

  it('an empty folder member greys every verb but Open', () => {
    const items = archiveRowMenu(rowCtx({ entry: { path: 'empty', dir: true } }))
    expect(labels(items)).toEqual([
      'Open',
      'Extract this folder',
      'Extract this folder to…',
      'Copy folder',
      'Delete from archive'
    ])
    expect(items.map((i) => !!i.disabled)).toEqual([false, true, true, true, true])
  })

  it('a folder member in a read-only container', () => {
    expect(labels(archiveRowMenu(rowCtx({ entry: docs, writable: false })))).toEqual([
      'Open',
      'Extract this folder',
      'Extract this folder to…',
      'Copy folder'
    ])
  })

  it('several marked: counts only the file members, extracts them too', () => {
    const extractMembers = vi.fn()
    const items = archiveRowMenu(
      rowCtx({ multi: ['docs', 'docs/a.txt', 'readme.txt'], extractMembers })
    )
    expect(labels(items)).toEqual([
      'Copy 2 items',
      'Extract 2 items here',
      'Extract 2 items to…',
      'Delete 2 items from archive'
    ])
    items[1].onPick?.()
    expect(extractMembers).toHaveBeenCalledWith(readme, ['docs/a.txt', 'readme.txt'], true)
    expect(labels(archiveRowMenu(rowCtx({ multi: ['docs/a.txt'], writable: false })))).toEqual([
      'Copy 1 item',
      'Extract 1 item here',
      'Extract 1 item to…'
    ])
  })

  it('several marked where nothing can act on several: the row its own menu', () => {
    expect(
      labels(
        archiveRowMenu(rowCtx({ multi: ['docs/a.txt', 'readme.txt'], caps: NONE, writable: false }))
      )
    ).toEqual(['Open'])
  })
})

const panelCtx = (over: Partial<ArchivePanelMenuContext> = {}): ArchivePanelMenuContext => ({
  archivePath: 'C:\\z\\w.zip',
  zip: 'w.zip',
  caps: ALL,
  writable: true,
  busy: false,
  extractAll: vi.fn(),
  addFiles: vi.fn(),
  ...over
})

describe("the archive panel's empty space", () => {
  it('a writable zip on the desktop: the table order', () => {
    expect(labels(archivePanelMenu(panelCtx()))).toEqual([
      'Extract here',
      'Extract to…',
      'Add files here…',
      'Copy address',
      'Show w.zip in File Explorer'
    ])
  })

  it('maps the extract rows to the whole archive', () => {
    const extractAll = vi.fn()
    const items = archivePanelMenu(panelCtx({ extractAll }))
    items[0].onPick?.()
    items[1].onPick?.()
    expect(extractAll.mock.calls).toEqual([[true], [false]])
  })

  it('a read-only container drops Add files', () => {
    expect(labels(archivePanelMenu(panelCtx({ writable: false })))).not.toContain('Add files here…')
  })

  it('greys the extract and add verbs while busy', () => {
    const items = archivePanelMenu(panelCtx({ busy: true }))
    expect(items.map((i) => !!i.disabled)).toEqual([true, true, true, false, false])
  })

  it('the phone page', () => {
    expect(labels(archivePanelMenu(panelCtx({ caps: NONE, writable: false })))).toEqual([
      'Copy address'
    ])
  })
})