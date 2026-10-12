import { describe, expect, it, vi } from 'vitest'
import {
  addMembers,
  ARCHIVE_COPY,
  deleteMembers,
  renameMember,
  runWithPassword,
  type ArchiveIpc,
  type PassQuestion
} from './archiveOps'

/** main's archive calls, faked: each test sets only what it reaches. */
function fakeIpc(over: Partial<ArchiveIpc>): ArchiveIpc {
  const no = (): never => {
    throw new Error('not expected')
  }
  return { archiveAdd: no, archiveDelete: no, archiveRename: no, trashFile: no, ...over }
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('runWithPassword', () => {
  it('runs with the remembered password and remembers one that worked', async () => {
    const remember = vi.fn()
    const run = vi.fn(async () => 'ok' as const)
    runWithPassword({ name: 'a.txt', run, remembered: 'pw', remember, ask: vi.fn(), say: vi.fn() })
    await flush()
    expect(run).toHaveBeenCalledWith('pw')
    expect(remember).toHaveBeenCalledWith('pw')
  })

  it('asks on password, says it was wrong the second time, and remembers the answer that worked', async () => {
    const remember = vi.fn()
    const asked: PassQuestion[] = []
    const run = vi.fn(async (pw: string | undefined) =>
      pw === 'right' ? ('ok' as const) : ('password' as const)
    )
    runWithPassword({
      name: 'a.txt',
      run,
      remembered: undefined,
      remember,
      ask: (q) => asked.push(q),
      say: vi.fn()
    })
    await flush()
    expect(asked).toHaveLength(1)
    expect(asked[0]).toMatchObject({ name: 'a.txt', wrong: false })
    asked[0].run('wrong')
    await flush()
    expect(asked).toHaveLength(2)
    expect(asked[1].wrong).toBe(true)
    expect(remember).not.toHaveBeenCalled()
    asked[1].run('right')
    await flush()
    expect(remember).toHaveBeenCalledWith('right')
  })

  it('says AES and unreadable once, in the message box', async () => {
    const say = vi.fn()
    runWithPassword({
      name: 'x',
      run: async () => 'aes',
      remembered: undefined,
      remember: vi.fn(),
      ask: vi.fn(),
      say
    })
    runWithPassword({
      name: 'y',
      run: async () => 'failed',
      remembered: undefined,
      remember: vi.fn(),
      ask: vi.fn(),
      say
    })
    await flush()
    expect(say.mock.calls).toEqual([[ARCHIVE_COPY.aes('x')], [ARCHIVE_COPY.unreadable('y')]])
  })
})

describe('addMembers', () => {
  const add = {
    container: 'C:\\z.zip',
    paths: ['C:\\a.txt'],
    dest: 'in',
    keepBoth: false,
    fromPrism: true
  }

  it('says why when main refuses', async () => {
    expect(await addMembers(fakeIpc({ archiveAdd: async () => 'encrypted' }), add)).toEqual({
      kind: 'said',
      message: ARCHIVE_COPY.addEncrypted
    })
    expect(await addMembers(fakeIpc({ archiveAdd: async () => 'failed' }), add)).toEqual({
      kind: 'said',
      message: ARCHIVE_COPY.addFailed
    })
  })

  it('stops on a taken name before anything is binned', async () => {
    const trashFile = vi.fn()
    const r = await addMembers(
      fakeIpc({
        archiveAdd: async () => ({ added: [], clashes: ['a.txt'], failed: [] }),
        trashFile
      }),
      add
    )
    expect(r).toEqual({ kind: 'clash', names: ['a.txt'] })
    expect(trashFile).not.toHaveBeenCalled()
  })

  it("a move of Prism's own rows bins the originals and gives the undo entry", async () => {
    const r = await addMembers(
      fakeIpc({
        archiveAdd: async () => ({
          added: [
            { src: 'C:\\a.txt', entry: 'in/a.txt' },
            { src: 'C:\\b.txt', entry: 'in/b.txt' }
          ],
          clashes: [],
          failed: []
        }),
        trashFile: async (p) => p === 'C:\\a.txt'
      }),
      add
    )
    expect(r).toEqual({
      kind: 'added',
      undo: {
        kind: 'archive-in',
        zip: 'C:\\z.zip',
        dest: 'in',
        entries: ['in/a.txt', 'in/b.txt'],
        originals: ['C:\\a.txt']
      }
    })
  })

  it('files from Windows are left alone', async () => {
    const trashFile = vi.fn()
    const r = await addMembers(
      fakeIpc({
        archiveAdd: async () => ({
          added: [{ src: 'C:\\a.txt', entry: 'in/a.txt' }],
          clashes: [],
          failed: []
        }),
        trashFile
      }),
      { ...add, fromPrism: false }
    )
    expect(r).toEqual({ kind: 'added', undo: null })
    expect(trashFile).not.toHaveBeenCalled()
  })
})

describe('deleteMembers', () => {
  it('names the one member that stayed, or counts several', async () => {
    const none = fakeIpc({ archiveDelete: async () => false })
    expect(await deleteMembers(none, 'z', ['d/a.txt'], ['a.txt'])).toBe('Couldn\'t delete "a.txt".')
    const half = fakeIpc({ archiveDelete: async (_z, p) => p === 'a' })
    expect(await deleteMembers(half, 'z', ['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(
      "2 of 3 couldn't be deleted from the archive."
    )
    expect(
      await deleteMembers(fakeIpc({ archiveDelete: async () => true }), 'z', ['a'], ['a'])
    ).toBeNull()
  })
})

describe('renameMember', () => {
  it('refreshes on ok, says a failure once, and hands a password back to the runner', async () => {
    const done = vi.fn()
    const say = vi.fn()
    const rename = { container: 'z', inner: 'a.txt', name: 'b.txt', pw: undefined }
    expect(
      await renameMember(fakeIpc({ archiveRename: async () => 'ok' }), rename, done, say)
    ).toBe('ok')
    expect(done).toHaveBeenCalledTimes(1)
    expect(
      await renameMember(fakeIpc({ archiveRename: async () => 'failed' }), rename, done, say)
    ).toBe('ok')
    expect(say).toHaveBeenCalledWith(ARCHIVE_COPY.renameFailed('b.txt'))
    expect(
      await renameMember(fakeIpc({ archiveRename: async () => 'password' }), rename, done, say)
    ).toBe('password')
  })
})

describe('the dialog copy', () => {
  it('is pinned', () => {
    expect(ARCHIVE_COPY.deleteTitle(['a.txt'])).toBe('Delete "a.txt" from the archive?')
    expect(ARCHIVE_COPY.deleteTitle(['a', 'b'])).toBe('Delete 2 items from the archive?')
    expect(ARCHIVE_COPY.deleteBody(1)).toBe(
      'This is permanent: a zip has no Recycle Bin to take it back from.'
    )
    expect(ARCHIVE_COPY.deleteBody(2)).toBe(
      'This is permanent: a zip has no Recycle Bin to take them back from.'
    )
    expect(ARCHIVE_COPY.clashTitle(['a.txt'])).toBe('"a.txt" is already in the archive')
    expect(ARCHIVE_COPY.clashTitle(['a', 'b'])).toBe('2 names are already in the archive')
  })
})
