import { describe, expect, it } from 'vitest'
import { archiveMenuRows } from './archiveMenus'

const labels = (ctx: Parameters<typeof archiveMenuRows>[0]): string[] =>
  archiveMenuRows(ctx).map((r) => r.label)

describe('the menus of a place inside an archive (#300)', () => {
  it('an archive row outside it (mockup 02)', () => {
    expect(labels({ kind: 'outside', writable: true })).toEqual([
      'Open',
      'Open in new tab',
      'Extract here',
      'Extract to...',
      'Add files...',
      'Copy',
      'Copy path',
      'Rename',
      'Delete',
      'Show in File Explorer',
      'Properties'
    ])
    expect(labels({ kind: 'outside', writable: false })).not.toContain('Add files...')
  })

  it('a folder inside (mockup 07): no Rename, ever', () => {
    expect(labels({ kind: 'folder', writable: true, zip: 'w.zip' })).toEqual([
      'Open',
      'Open in new tab',
      'Extract this folder',
      'Extract this folder to...',
      'Add files here...',
      'Copy folder',
      'Delete from zip',
      'Show w.zip in File Explorer',
      'Properties'
    ])
    const ro = labels({ kind: 'folder', writable: false, zip: 'w.7z' })
    expect(ro.some((l) => /Rename|Delete|Add/.test(l))).toBe(false)
  })

  it('a file inside (mockup 08): no Open with', () => {
    expect(labels({ kind: 'file', writable: true, zip: 'w.zip' })).toEqual([
      'Open',
      'Extract this file',
      'Extract this file to...',
      'Copy file',
      'Rename',
      'Delete from zip',
      'Show w.zip in File Explorer',
      'Properties'
    ])
    expect(labels({ kind: 'file', writable: false, zip: 'w.7z' })).toEqual([
      'Open',
      'Extract this file',
      'Extract this file to...',
      'Copy file',
      'Show w.7z in File Explorer',
      'Properties'
    ])
  })

  it('several rows, and the empty space', () => {
    expect(labels({ kind: 'many', writable: true, count: 3, zip: 'w.zip' })).toEqual([
      'Copy 3 items',
      'Extract 3 items here',
      'Extract 3 items to...',
      'Delete 3 items from zip'
    ])
    expect(labels({ kind: 'many', writable: false, count: 2, zip: 'w.zip' })).not.toContain(
      'Delete 2 items from zip'
    )
    expect(labels({ kind: 'empty', writable: true, zip: 'w.zip' })).toEqual([
      'Extract here',
      'Extract to...',
      'Add files here...',
      'Show w.zip in File Explorer',
      'Copy address'
    ])
  })

  it('the danger row is marked', () => {
    const del = archiveMenuRows({ kind: 'file', writable: true, zip: 'w.zip' }).find((r) => r.id === 'delete')
    expect(del?.danger).toBe(true)
  })
})
