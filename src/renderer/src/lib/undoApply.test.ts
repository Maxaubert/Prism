import { describe, expect, it, vi } from 'vitest'
import { redoEntry, undoEntry, type UndoOps } from './undoApply'

// The inverse table, driven with fakes: what each undo and redo asks for, in
// what order, and the entry it hands back corrected.
function fakeOps(over: Partial<UndoOps['prism']> = {}): UndoOps & { calls: string[] } {
  const calls: string[] = []
  const log =
    (name: string, answer: unknown) =>
    async (...args: unknown[]): Promise<never> => {
      calls.push(`${name} ${JSON.stringify(args)}`)
      return answer as never
    }
  return {
    calls,
    move: vi.fn(async (paths: string[], dest: string) => {
      calls.push(`move ${JSON.stringify([paths, dest])}`)
      return paths.map((p) => ({ from: p, to: `${dest}\\${p.split('\\').pop()} (2)` }))
    }),
    rename: vi.fn(async (path: string, name: string) => {
      calls.push(`rename ${JSON.stringify([path, name])}`)
      return `C:\\d\\${name}`
    }),
    refresh: vi.fn(() => void calls.push('refresh')),
    fail: vi.fn((m: string) => void calls.push(`fail ${m}`)),
    prism: {
      restoreFromBin: log('restore', true),
      trashFile: log('trash', true),
      binIfEmpty: log('binIfEmpty', 'binned'),
      archiveDelete: log('archiveDelete', true),
      duplicateFile: log('duplicate', 'C:\\d\\a - Copy.txt'),
      newFolder: log('newFolder', 'C:\\d\\New folder'),
      archiveAdd: log('archiveAdd', { added: [{ src: 'C:\\d\\a.txt', entry: 'a (2).txt' }] }),
      ...over
    } as UndoOps['prism']
  }
}

describe('undoEntry', () => {
  it('moves each item back beside its old place, then restores what it replaced', async () => {
    const ops = fakeOps()
    const back = await undoEntry(
      {
        kind: 'move',
        items: [{ from: 'C:\\a\\x.txt', to: 'C:\\b\\x.txt' }],
        replaced: ['C:\\b\\old']
      },
      ops
    )
    expect(ops.calls).toEqual([
      'move [["C:\\\\b\\\\x.txt"],"C:\\\\a"]',
      'restore [["C:\\\\b\\\\old"]]',
      'refresh'
    ])
    // corrected to where it really landed, and nothing left to restore
    expect(back).toEqual({
      kind: 'move',
      items: [{ from: 'C:\\a\\x.txt (2)', to: 'C:\\b\\x.txt' }],
      replaced: undefined
    })
  })

  it('renames back and keeps the name it got', async () => {
    const ops = fakeOps()
    const back = await undoEntry({ kind: 'rename', from: 'C:\\d\\a.txt', to: 'C:\\d\\b.txt' }, ops)
    expect(ops.rename).toHaveBeenCalledWith('C:\\d\\b.txt', 'a.txt')
    expect(back).toEqual({
      kind: 'rename',
      from: 'C:\\d\\a.txt',
      to: 'C:\\d\\b.txt',
      replaced: undefined
    })
  })

  it('says so when Windows will not give binned files back', async () => {
    const ops = fakeOps({ restoreFromBin: async () => false })
    await undoEntry({ kind: 'trash', paths: ['C:\\d\\a.txt'] }, ops)
    expect(ops.fail).toHaveBeenCalledWith(
      'Windows would not give those back. They may have been emptied from the Recycle Bin.'
    )
  })

  it('leaves a new folder that has something in it', async () => {
    const ops = fakeOps({ binIfEmpty: async () => 'not-empty' as const })
    await undoEntry({ kind: 'mkdir', path: 'C:\\d\\New folder' }, ops)
    expect(ops.fail).toHaveBeenCalledWith(
      'That folder has something in it now, so it was left where it is.'
    )
  })

  it('takes members out of a zip and counts the ones that stuck', async () => {
    const ops = fakeOps({ archiveDelete: async (_zip: string, e: string) => e !== 'b' })
    await undoEntry(
      { kind: 'archive-in', zip: 'C:\\z.zip', dest: '', entries: ['a', 'b'], originals: ['C:\\a'] },
      ops
    )
    expect(ops.fail).toHaveBeenCalledWith('1 of 2 could not be taken back out of the archive.')
  })
})

describe('redoEntry', () => {
  it('asks the source for another copy and remembers the new one', async () => {
    const ops = fakeOps()
    const again = await redoEntry({ kind: 'duplicate', source: 'C:\\d\\a.txt', path: 'old' }, ops)
    expect(again).toEqual({
      kind: 'duplicate',
      source: 'C:\\d\\a.txt',
      path: 'C:\\d\\a - Copy.txt'
    })
  })

  it('makes the folder again under the name it gets', async () => {
    const ops = fakeOps()
    const again = await redoEntry({ kind: 'mkdir', path: 'C:\\d\\Stuff' }, ops)
    expect(ops.calls[0]).toBe('newFolder ["C:\\\\d","Stuff"]')
    expect(again).toEqual({ kind: 'mkdir', path: 'C:\\d\\New folder' })
  })

  it('bins only the originals that landed in the zip', async () => {
    const ops = fakeOps()
    const again = await redoEntry(
      {
        kind: 'archive-in',
        zip: 'C:\\z.zip',
        dest: '',
        entries: [],
        originals: ['C:\\d\\a.txt', 'C:\\d\\b.txt']
      },
      ops
    )
    expect(ops.calls.filter((c) => c.startsWith('trash'))).toEqual(['trash ["C:\\\\d\\\\a.txt"]'])
    expect(again).toMatchObject({ entries: ['a (2).txt'], originals: ['C:\\d\\a.txt'] })
  })

  it('a refused archive write moves nothing', async () => {
    const ops = fakeOps({ archiveAdd: async () => 'failed' as const })
    expect(
      await redoEntry(
        { kind: 'archive-in', zip: 'z', dest: '', entries: [], originals: ['a'] },
        ops
      )
    ).toBeUndefined()
    expect(ops.fail).toHaveBeenCalledWith(
      'That archive could not be written, so nothing was moved into it.'
    )
  })
})

describe('what an undo or redo puts back is marked (#101)', () => {
  const landing = (): UndoOps & { calls: string[]; landed: string[][] } => {
    const ops = fakeOps() as UndoOps & { calls: string[]; landed: string[][] }
    ops.landed = []
    ops.land = (paths) => void ops.landed.push([...paths])
    return ops
  }
  it('an undone move marks where each item came back to', async () => {
    const ops = landing()
    await undoEntry({ kind: 'move', items: [{ from: 'C:\\a\\x.txt', to: 'C:\\b\\x.txt' }] }, ops)
    expect(ops.landed).toEqual([['C:\\a\\x.txt (2)']])
  })
  it('an undone rename and an undone delete mark what came back', async () => {
    const ops = landing()
    await undoEntry({ kind: 'rename', from: 'C:\\d\\old.txt', to: 'C:\\d\\new.txt' }, ops)
    await undoEntry({ kind: 'trash', paths: ['C:\\d\\gone.txt'] }, ops)
    expect(ops.landed).toEqual([['C:\\d\\old.txt'], ['C:\\d\\gone.txt']])
  })
  it('a redone move, duplicate and new folder mark what they made', async () => {
    const ops = landing()
    await redoEntry({ kind: 'move', items: [{ from: 'C:\\a\\x.txt', to: 'C:\\b\\x.txt' }] }, ops)
    await redoEntry({ kind: 'duplicate', source: 'C:\\d\\a.txt', path: 'C:\\d\\a - Copy.txt' }, ops)
    await redoEntry({ kind: 'mkdir', path: 'C:\\d\\New folder' }, ops)
    expect(ops.landed).toEqual([['C:\\b\\x.txt (2)'], ['C:\\d\\a - Copy.txt'], ['C:\\d\\New folder']])
  })
  // A failed item never came back, so marking its old path would make the
  // list wait the whole LAND_MARK_MS for a row that is not coming.
  it('an undo or redo of a move marks only the items that really moved', async () => {
    const ops = landing()
    ops.move = vi.fn(async (paths: string[], dest: string) =>
      paths[0].includes('stuck')
        ? []
        : paths.map((p) => ({ from: p, to: `${dest}\\${p.split('\\').pop()}` }))
    )
    const items = [
      { from: 'C:\\a\\x.txt', to: 'C:\\b\\x.txt' },
      { from: 'C:\\a\\stuck.txt', to: 'C:\\b\\stuck.txt' }
    ]
    const back = await undoEntry({ kind: 'move', items }, ops)
    await redoEntry({ kind: 'move', items }, ops)
    expect(ops.landed).toEqual([['C:\\a\\x.txt'], ['C:\\b\\x.txt']])
    // The entry still names the stuck item where it is, as before.
    expect(back && back.kind === 'move' ? back.items : null).toEqual(items)
  })
})

// A MOVE INSIDE A ZIP IS UNDOABLE (#70 D8; owner approved the spec "as
// recommended", 2026-11-01): undo moves each member back to its old folder
// under its old name, grouped by folder; redo moves them again.
describe('archive-move', () => {
  type Moved = Array<{ from: string; to: string }>
  const zipOps = (
    answer: (entries: string[], dest: string, names?: string[]) => unknown
  ): UndoOps & { calls: string[]; landed: string[][] } => {
    const ops = fakeOps({
      archiveMoveMembers: async (
        zip: string,
        entries: string[],
        dest: string,
        keepBoth?: boolean,
        names?: string[]
      ) => {
        ops.calls.push(`zipMove ${JSON.stringify([zip, entries, dest, keepBoth, names])}`)
        return answer(entries, dest, names) as never
      }
    }) as UndoOps & { calls: string[]; landed: string[][] }
    ops.landed = []
    ops.land = (paths) => void ops.landed.push([...paths])
    return ops
  }
  const moveBack = (
    entries: string[],
    dest: string,
    names?: string[]
  ): { moved: Moved; clashes: string[] } => ({
    moved: entries.map((e, i) => ({
      from: e,
      to: `${dest ? dest + '/' : ''}${names?.[i] ?? e.split('/').pop()}`
    })),
    clashes: []
  })

  it('undo puts each member back in its old folder under its old name, one call per folder', async () => {
    const ops = zipOps(moveBack)
    const back = await undoEntry(
      {
        kind: 'archive-move',
        zip: 'C:\\z.zip',
        base: 'C:\\z.zip',
        items: [
          { from: 'a.txt', to: 'docs/a (2).txt' },
          { from: 'img', to: 'docs/img' },
          { from: 'x/b.txt', to: 'docs/b.txt' }
        ]
      },
      ops
    )
    expect(ops.calls.filter((c) => c.startsWith('zipMove'))).toEqual([
      'zipMove ["C:\\\\z.zip",["docs/a (2).txt","docs/img"],"",true,["a.txt","img"]]',
      'zipMove ["C:\\\\z.zip",["docs/b.txt"],"x",true,["b.txt"]]'
    ])
    expect(ops.calls).toContain('refresh')
    expect(back).toMatchObject({
      items: [
        { from: 'a.txt', to: 'docs/a (2).txt' },
        { from: 'img', to: 'docs/img' },
        { from: 'x/b.txt', to: 'docs/b.txt' }
      ]
    })
    // What came back is marked where the Explorer shows it (#101).
    expect(ops.landed).toEqual([['C:\\z.zip\\a.txt', 'C:\\z.zip\\img', 'C:\\z.zip\\x\\b.txt']])
  })

  it('redo moves them again, under the names they had', async () => {
    const ops = zipOps(moveBack)
    const again = await redoEntry(
      {
        kind: 'archive-move',
        zip: 'C:\\z.zip',
        base: 'C:\\z.zip',
        items: [{ from: 'a.txt', to: 'docs/a (2).txt' }]
      },
      ops
    )
    expect(ops.calls[0]).toBe('zipMove ["C:\\\\z.zip",["a.txt"],"docs",true,["a (2).txt"]]')
    expect(again).toMatchObject({ items: [{ from: 'a.txt', to: 'docs/a (2).txt' }] })
    expect(ops.landed).toEqual([['C:\\z.zip\\docs\\a (2).txt']])
  })

  it('a member that is gone stays named where it was, and the undo says so', async () => {
    const ops = zipOps((entries, dest, names) =>
      moveBack(
        entries.filter((e) => e !== 'docs/gone.txt'),
        dest,
        names?.filter((n) => n !== 'gone.txt')
      )
    )
    const back = await undoEntry(
      {
        kind: 'archive-move',
        zip: 'C:\\z.zip',
        items: [
          { from: 'a.txt', to: 'docs/a.txt' },
          { from: 'gone.txt', to: 'docs/gone.txt' }
        ]
      },
      ops
    )
    expect(back).toMatchObject({
      items: [
        { from: 'a.txt', to: 'docs/a.txt' },
        { from: 'gone.txt', to: 'docs/gone.txt' }
      ]
    })
    expect(ops.fail).toHaveBeenCalledWith('1 of 2 could not be moved back inside the archive.')
  })

  it('an archive that refuses the write moves nothing and says so', async () => {
    const ops = zipOps(() => 'failed')
    await undoEntry(
      { kind: 'archive-move', zip: 'C:\\z.zip', items: [{ from: 'a.txt', to: 'docs/a.txt' }] },
      ops
    )
    expect(ops.fail).toHaveBeenCalledWith('1 of 1 could not be moved back inside the archive.')
    const redo = zipOps(() => 'encrypted')
    await redoEntry(
      { kind: 'archive-move', zip: 'C:\\z.zip', items: [{ from: 'a.txt', to: 'docs/a.txt' }] },
      redo
    )
    expect(redo.fail).toHaveBeenCalledWith('1 of 1 could not be moved again inside the archive.')
  })
})
