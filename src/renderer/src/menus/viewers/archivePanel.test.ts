import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuItem } from '../../components/ContextMenu'
import {
  archivePanelMenu,
  archiveRowMenu,
  type ArchiveMember,
  type ArchivePanelMenuContext,
  type ArchiveRowMenuContext
} from './archivePanel'

// The unit tests run under node, where `window` does not exist; in a browser
// it IS globalThis, which is what the phone shim leans on too.
if (typeof window === 'undefined')
  Object.defineProperty(globalThis, 'window', { value: globalThis })

beforeEach(() => {
  ;(globalThis as unknown as { prism: unknown }).prism = {
    capabilities: { write: true, clipboard: true, explorer: true, drag: true },
    showInExplorer: vi.fn()
  }
})
afterEach(() => {
  delete (globalThis as unknown as { prism?: unknown }).prism
})

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

describe('an archive member row', () => {
  it('a file member in a writable zip', () => {
    expect(labels(archiveRowMenu(rowCtx()))).toEqual([
      'View',
      'Copy file',
      'Extract here',
      'Extract to…',
      'Rename',
      'Delete from archive'
    ])
  })

  it('a file member in a read-only container', () => {
    expect(labels(archiveRowMenu(rowCtx({ writable: false })))).toEqual([
      'View',
      'Copy file',
      'Extract here',
      'Extract to…'
    ])
  })

  it('a file member on the phone page: View alone', () => {
    expect(labels(archiveRowMenu(rowCtx({ caps: NONE, writable: false })))).toEqual(['View'])
  })

  it('a folder member', () => {
    const items = archiveRowMenu(rowCtx({ entry: docs }))
    expect(labels(items)).toEqual([
      'Open',
      'Copy folder',
      'Extract folder here',
      'Extract folder to…',
      'Copy 2 files inside',
      'Delete 2 files from archive'
    ])
    expect(items.some((i) => i.disabled)).toBe(false)
  })

  it('an empty folder member greys every verb but Open', () => {
    const items = archiveRowMenu(rowCtx({ entry: { path: 'empty', dir: true } }))
    expect(labels(items)).toEqual([
      'Open',
      'Copy folder',
      'Extract folder here',
      'Extract folder to…',
      'Copy 0 files inside',
      'Delete 0 files from archive'
    ])
    expect(items.map((i) => !!i.disabled)).toEqual([false, true, true, true, true, true])
  })

  it('a folder member in a read-only container', () => {
    expect(labels(archiveRowMenu(rowCtx({ entry: docs, writable: false })))).toEqual([
      'Open',
      'Copy folder',
      'Extract folder here',
      'Extract folder to…',
      'Copy 2 files inside'
    ])
  })

  it('several marked: counts only the file members', () => {
    expect(labels(archiveRowMenu(rowCtx({ multi: ['docs', 'docs/a.txt', 'readme.txt'] })))).toEqual(
      ['Copy 2 files', 'Delete 2 from archive']
    )
    expect(labels(archiveRowMenu(rowCtx({ multi: ['docs/a.txt'], writable: false })))).toEqual([
      'Copy 1 file'
    ])
  })

  it('several marked where nothing can act on several: the row its own menu', () => {
    expect(
      labels(
        archiveRowMenu(rowCtx({ multi: ['docs/a.txt', 'readme.txt'], caps: NONE, writable: false }))
      )
    ).toEqual(['View'])
  })
})

const panelCtx = (over: Partial<ArchivePanelMenuContext> = {}): ArchivePanelMenuContext => ({
  archivePath: 'C:\\z\\w.zip',
  caps: ALL,
  writable: true,
  busy: false,
  hasRows: true,
  extractAll: vi.fn(),
  addFiles: vi.fn(),
  selectAll: vi.fn(),
  ...over
})

describe("the archive panel's empty space", () => {
  it('a writable zip on the desktop', () => {
    expect(labels(archivePanelMenu(panelCtx()))).toEqual([
      'Extract all…',
      'Add files…',
      'Select all',
      'Extract here',
      'Extract to…',
      'Copy archive',
      'Show in File Explorer',
      'Copy path'
    ])
  })

  it('a read-only container drops Add files', () => {
    expect(labels(archivePanelMenu(panelCtx({ writable: false })))).not.toContain('Add files…')
  })

  it('greys the extract and add verbs while busy, Select all with no rows', () => {
    const items = archivePanelMenu(panelCtx({ busy: true, hasRows: false }))
    expect(items.map((i) => !!i.disabled)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false
    ])
  })

  it('the phone page', () => {
    expect(labels(archivePanelMenu(panelCtx({ caps: NONE, writable: false })))).toEqual([
      'Select all',
      'Copy path'
    ])
  })
})
