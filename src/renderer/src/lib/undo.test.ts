import { describe, expect, it } from 'vitest'
import {
  describe as label,
  emptyUndo,
  entryPlaces,
  entrySize,
  entryStoppable,
  entryVerb,
  redone,
  remember,
  rememberRename,
  undone,
  type UndoEntry
} from './undo'

const move: UndoEntry = { kind: 'move', items: [{ from: 'C:\\a\\f.txt', to: 'C:\\b\\f.txt' }] }
const ren: UndoEntry = { kind: 'rename', from: 'C:\\a\\old.txt', to: 'C:\\a\\new.txt' }
const bin: UndoEntry = { kind: 'trash', paths: ['C:\\a\\x.txt', 'C:\\a\\y.txt'] }

describe('the undo stack', () => {
  it('has nothing to undo or redo when empty', () => {
    expect(undone(emptyUndo)).toBeNull()
    expect(redone(emptyUndo)).toBeNull()
  })

  it('undoes the newest action first, and redo puts it back', () => {
    const s = remember(remember(emptyUndo, move), ren)
    const u = undone(s)!
    expect(u.entry).toBe(ren)
    expect(u.state.past).toEqual([move])
    const r = redone(u.state)!
    expect(r.entry).toBe(ren)
    expect(r.state.past).toEqual([move, ren])
    expect(r.state.future).toEqual([])
  })

  it('a fresh action abandons the redo branch', () => {
    const s = undone(remember(emptyUndo, move))!.state
    expect(s.future).toEqual([move])
    expect(remember(s, bin).future).toEqual([])
  })

  it('walks all the way back and all the way forward again', () => {
    let s = remember(remember(remember(emptyUndo, move), ren), bin)
    const order: UndoEntry[] = []
    for (let i = 0; i < 3; i += 1) {
      const u = undone(s)!
      order.push(u.entry)
      s = u.state
    }
    expect(order).toEqual([bin, ren, move])
    expect(undone(s)).toBeNull()
    expect(redone(s)!.entry).toBe(move)
  })

  it('keeps the history shallow', () => {
    let s = emptyUndo
    for (let i = 0; i < 60; i += 1)
      s = remember(s, { kind: 'duplicate', source: 'C:\\a\\src.txt', path: `C:\\a\\${i}.txt` })
    expect(s.past.length).toBe(40)
    expect(undone(s)!.entry).toEqual({ kind: 'duplicate', source: 'C:\\a\\src.txt', path: 'C:\\a\\59.txt' })
  })

  it('names a new folder for the message (#330)', () => {
    expect(label({ kind: 'mkdir', path: 'C:\\a\\New folder (2)' })).toBe('making New folder (2)')
  })

  it('names an archive move for the message too', () => {
    expect(
      label({ kind: 'archive-in', zip: 'C:\\a\\box.zip', dest: '', entries: ['one.txt'], originals: [] })
    ).toBe('moving one.txt into box.zip')
  })

  it('names the action for the message that reports it', () => {
    expect(label(ren)).toBe('renaming old.txt')
    expect(label(bin)).toBe('deleting 2 items')
    expect(label(move)).toBe('moving f.txt')
    expect(label({ kind: 'duplicate', source: 'C:\\a\\p.png', path: 'C:\\a\\p (2).png' })).toBe('duplicating p (2).png')
  })
})

// RESTORE FROM THE BIN VIEW IS UNDOABLE (Recycle Bin, D18): the exact mirror
// of `trash`, so the two agree when they meet on the stack.
describe('the unbin entry (Recycle Bin, D18)', () => {
  const unbin: UndoEntry = { kind: 'unbin', paths: ['C:\\a\\x.txt', 'D:\\b\\y.txt'] }
  it('is named for the message', () => {
    expect(label(unbin)).toBe('restoring 2 items')
    expect(label({ kind: 'unbin', paths: ['C:\\a\\x.txt'] })).toBe('restoring x.txt')
  })
  it('counts its paths for the loading bar', () => {
    expect(entrySize(unbin)).toBe(2)
  })
  it('holds the folders the items sit in', () => {
    expect(entryPlaces(unbin)).toEqual({ dirs: ['C:\\a', 'D:\\b'], under: unbin.paths })
  })
  it('says the opposite of trash: undo deletes (back into the bin), redo restores', () => {
    expect(entryVerb(unbin, 'undo')).toBe('Deleting')
    expect(entryVerb(unbin, 'redo')).toBe('Restoring')
    expect(entryVerb(bin, 'undo')).toBe('Restoring')
  })
  it('is stoppable and walks the stack like any entry', () => {
    expect(entryStoppable(unbin)).toBe(true)
    const s = remember(remember(emptyUndo, bin), unbin)
    expect(undone(s)!.entry).toBe(unbin)
    expect(undone(undone(s)!.state)!.entry).toBe(bin)
  })
})

describe('rememberRename (#330)', () => {
  const made: UndoEntry = { kind: 'mkdir', path: 'C:\\a\\New folder' }
  it('folds the rename of a folder just made into its entry, so one undo takes it away', () => {
    const s = rememberRename(remember(emptyUndo, made), { kind: 'rename', from: 'C:\\a\\new FOLDER', to: 'C:\\a\\Photos' })
    expect(s.past).toEqual([{ kind: 'mkdir', path: 'C:\\a\\Photos' }])
    expect(undone(s)!.entry).toEqual({ kind: 'mkdir', path: 'C:\\a\\Photos' })
  })
  it('stacks any other rename as before', () => {
    const s = rememberRename(remember(emptyUndo, made), ren as Extract<UndoEntry, { kind: 'rename' }>)
    expect(s.past).toEqual([made, ren])
    const over = rememberRename(remember(emptyUndo, made), { kind: 'rename', from: 'C:\\a\\New folder', to: 'C:\\a\\x', replaced: 'C:\\a\\x' })
    expect(over.past.length).toBe(2)
    expect(rememberRename(emptyUndo, ren as Extract<UndoEntry, { kind: 'rename' }>).past).toEqual([ren])
  })
})
