import { describe, expect, it } from 'vitest'
import { archiveCardMenuRows } from './archiveCardMenu'

const labels = (rows: Array<{ label: string }>): string[] => rows.map((r) => r.label)

describe('the zip card menu (#483)', () => {
  it('a file row', () => {
    expect(labels(archiveCardMenuRows({ kind: 'file', zip: 'W-13.zip' }))).toEqual([
      'Open',
      'Extract this file',
      'Extract this file to...',
      'Copy file'
    ])
  })
  it('a folder row', () => {
    expect(labels(archiveCardMenuRows({ kind: 'folder', zip: 'W-13.zip' }))).toEqual([
      'Open',
      'Extract this folder',
      'Extract this folder to...',
      'Copy folder'
    ])
  })
  it('several rows', () => {
    expect(labels(archiveCardMenuRows({ kind: 'many', count: 2, zip: 'W-13.zip' }))).toEqual([
      'Copy 2 items',
      'Extract 2 items here',
      'Extract 2 items to...'
    ])
  })
  it('never leaves the card or changes the zip', () => {
    for (const ctx of [
      { kind: 'file' as const, zip: 'z.zip' },
      { kind: 'folder' as const, zip: 'z.zip' },
      { kind: 'many' as const, count: 3, zip: 'z.zip' }
    ]) {
      const ids = archiveCardMenuRows(ctx).map((r) => r.id)
      for (const id of ['open-new-tab', 'show', 'rename', 'delete', 'add-files', 'properties'] as const)
        expect(ids).not.toContain(id)
    }
  })
})
