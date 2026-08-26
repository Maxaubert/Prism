import { describe, expect, it } from 'vitest'
import { describe as label, emptyUndo, redone, remember, undone, type UndoEntry } from './undo'

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
