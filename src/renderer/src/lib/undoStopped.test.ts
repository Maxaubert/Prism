import { describe, expect, it, vi } from 'vitest'
import { emptyUndo, entryPlaces, entrySize, stoppedStep, type UndoEntry, type UndoState } from './undo'
import { undoEntry, redoEntry, type UndoOps } from './undoApply'

const prism = {
  restoreFromBin: vi.fn(async () => true),
  trashFile: vi.fn(async () => true),
  binIfEmpty: vi.fn(async () => 'ok' as const),
  archiveDelete: vi.fn(async () => true),
  duplicateFile: vi.fn(async () => 'C:\\a\\copy.txt'),
  newFolder: vi.fn(async () => 'C:\\a\\new'),
  archiveAdd: vi.fn(async () => 'failed' as const),
  archiveMoveMembers: vi.fn(async () => 'failed' as const)
} as unknown as UndoOps['prism']

describe('Cancel partway through an undo (owner, 2026-11-09)', () => {
  const entry: UndoEntry = { kind: 'trash', paths: ['C:\\a\\1', 'C:\\a\\2', 'C:\\a\\3'] }

  it('leaves the undo stack saying exactly what really happened', () => {
    const state: UndoState = { past: [], future: [entry] }
    const done: UndoEntry = { kind: 'trash', paths: ['C:\\a\\1'] }
    const rest: UndoEntry = { kind: 'trash', paths: ['C:\\a\\2', 'C:\\a\\3'] }
    const after = stoppedStep(state, entry, done, rest, 'undo')
    expect(after.past).toEqual([rest])
    expect(after.future).toEqual([done])
  })

  it('a redo stopped partway leaves the same on the other side', () => {
    const state: UndoState = { past: [entry], future: [] }
    const done: UndoEntry = { kind: 'trash', paths: ['C:\\a\\1'] }
    const rest: UndoEntry = { kind: 'trash', paths: ['C:\\a\\2', 'C:\\a\\3'] }
    const after = stoppedStep(state, entry, done, rest, 'redo')
    expect(after.past).toEqual([done])
    expect(after.future).toEqual([rest])
  })

  it('nothing done: the entry goes back where it was and redo stays empty', () => {
    const state: UndoState = { ...emptyUndo, future: [entry] }
    const after = stoppedStep(state, entry, null, entry, 'undo')
    expect(after.past).toEqual([entry])
    expect(after.future).toEqual([])
  })

  it('a move undone is stopped between items, and the rest stays undoable', async () => {
    const move: Extract<UndoEntry, { kind: 'move' }> = {
      kind: 'move',
      items: [
        { from: 'C:\\a\\1', to: 'C:\\b\\1' },
        { from: 'C:\\a\\2', to: 'C:\\b\\2' }
      ]
    }
    const ac = new AbortController()
    let stopped: unknown = null
    const ops: UndoOps = {
      move: vi.fn(async ([to]: string[]) => {
        ac.abort()
        return [{ from: to, to: to.replace('b', 'a') }]
      }),
      rename: vi.fn(async () => null),
      refresh: vi.fn(),
      fail: vi.fn(),
      land: vi.fn(),
      signal: ac.signal,
      stopped: (done, rest) => {
        stopped = { done, rest }
      },
      prism
    }
    await undoEntry(move, ops)
    expect(ops.move).toHaveBeenCalledTimes(1)
    expect(stopped).toEqual({
      done: { kind: 'move', items: [{ from: 'C:\\a\\1', to: 'C:\\b\\1' }], replaced: undefined },
      rest: { kind: 'move', items: [{ from: 'C:\\a\\2', to: 'C:\\b\\2' }] }
    })
  })

  const inFlight = (ac: AbortController, move: UndoOps['move']): { ops: UndoOps; seen: () => unknown } => {
    let stopped: unknown = null
    return {
      seen: () => stopped,
      ops: {
        move,
        rename: vi.fn(async () => null),
        refresh: vi.fn(),
        fail: vi.fn(),
        land: vi.fn(),
        signal: ac.signal,
        stopped: (done, rest) => {
          stopped = { done, rest }
        },
        prism
      }
    }
  }
  const twoMoved: Extract<UndoEntry, { kind: 'move' }> = {
    kind: 'move',
    items: [
      { from: 'C:\\a\\1', to: 'C:\\b\\1' },
      { from: 'C:\\a\\2', to: 'C:\\b\\2' }
    ]
  }

  it('an undo item Cancel caught in flight did not move: it stays on the undo', async () => {
    const ac = new AbortController()
    let call = 0
    const { ops, seen } = inFlight(ac, async ([to]) => {
      call += 1
      if (call === 1) return [{ from: to, to: to.replace('b', 'a') }]
      ac.abort()
      return []
    })
    expect(await undoEntry(twoMoved, ops)).toBeUndefined()
    expect(seen()).toEqual({
      done: { kind: 'move', items: [{ from: 'C:\\b\\1'.replace('b', 'a'), to: 'C:\\b\\1' }], replaced: undefined },
      rest: { kind: 'move', items: [twoMoved.items[1]] }
    })
  })

  it('a redo item Cancel caught in flight did not move: it stays on the redo', async () => {
    const ac = new AbortController()
    const { ops, seen } = inFlight(ac, async () => {
      ac.abort()
      return []
    })
    expect(await redoEntry(twoMoved, ops)).toBeUndefined()
    expect(seen()).toEqual({ done: null, rest: twoMoved })
  })

  it('a restore as a job reports what came back and what stayed in the bin', async () => {
    let stopped: unknown = null
    const ops: UndoOps = {
      move: vi.fn(),
      rename: vi.fn(),
      refresh: vi.fn(),
      fail: vi.fn(),
      land: vi.fn(),
      stopped: (done, rest) => {
        stopped = { done, rest }
      },
      restoreJob: async () => ({
        ok: false,
        restored: ['C:\\a\\1'],
        left: ['C:\\a\\2', 'C:\\a\\3'],
        cancelled: true
      }),
      prism
    }
    await undoEntry(entry, ops)
    expect(stopped).toEqual({
      done: { kind: 'trash', paths: ['C:\\a\\1'] },
      rest: { kind: 'trash', paths: ['C:\\a\\2', 'C:\\a\\3'] }
    })
    expect(ops.land).toHaveBeenCalledWith(['C:\\a\\1'])
    expect(ops.fail).not.toHaveBeenCalled()
  })

  it('a redo of a delete stops between files', async () => {
    const ac = new AbortController()
    const trashFile = vi.fn(async () => {
      ac.abort()
      return true
    })
    let stopped: unknown = null
    await redoEntry(entry, {
      move: vi.fn(),
      rename: vi.fn(),
      refresh: vi.fn(),
      fail: vi.fn(),
      signal: ac.signal,
      stopped: (done, rest) => {
        stopped = { done, rest }
      },
      prism: { ...prism, trashFile } as UndoOps['prism']
    })
    expect(trashFile).toHaveBeenCalledTimes(1)
    expect(stopped).toEqual({
      done: { kind: 'trash', paths: ['C:\\a\\1'] },
      rest: { kind: 'trash', paths: ['C:\\a\\2', 'C:\\a\\3'] }
    })
  })

  it('a step names the folders it changes, for the hold', () => {
    expect(entryPlaces(entry).dirs).toEqual(['C:\\a'])
    expect(entrySize(entry)).toBe(3)
  })
})
