import { describe, expect, it } from 'vitest'
import type { NativeDragRecord } from '@shared/dragOut'
import { ownDropFrom, requestOf } from './dragOut'

const record = (paths: string[], cargo?: NativeDragRecord['cargo']): NativeDragRecord => ({
  token: 1,
  paths,
  cargo: cargo ?? { kind: 'files', paths },
  source: 1
})

describe('drops back into Prism (#103)', () => {
  it('the dragged paths, matched to the record, are Prism cargo: a move (D4)', () => {
    const r = record(['C:\\a\\x.txt', 'C:\\a\\y.txt'])
    expect(ownDropFrom(['c:\\A\\Y.txt', 'C:\\a\\x.txt'], r)).toEqual({ kind: 'files', paths: ['C:\\a\\x.txt', 'C:\\a\\y.txt'] })
  })

  it('with no record the drop is from Windows: a copy (D3)', () => {
    expect(ownDropFrom(['C:\\a\\x.txt'], null)).toEqual({ kind: 'files', paths: ['C:\\a\\x.txt'], external: true })
  })

  it('a record for OTHER paths never moves the recorded files (the old wrong-file move)', () => {
    const r = record(['C:\\a\\old.txt'])
    expect(ownDropFrom(['C:\\b\\new.txt'], r)).toEqual({ kind: 'files', paths: ['C:\\b\\new.txt'], external: true })
    // A part of the set is not the set.
    const two = record(['C:\\a\\x.txt', 'C:\\a\\y.txt'])
    expect(ownDropFrom(['C:\\a\\x.txt'], two)).toEqual({ kind: 'files', paths: ['C:\\a\\x.txt'], external: true })
  })

  it('members come back as members: the temp copies extract from the archive again', () => {
    const r = record(['C:\\temp\\run\\h1\\a.txt'], { kind: 'members', archive: 'C:\\z.zip', entries: ['docs/a.txt'] })
    expect(ownDropFrom(['C:\\temp\\run\\h1\\a.txt'], r)).toEqual({ kind: 'members', archive: 'C:\\z.zip', entries: ['docs/a.txt'] })
  })

  it('nothing dropped is nothing', () => {
    expect(ownDropFrom([], record(['C:\\a']))).toBeNull()
  })

  it('requestOf: files as they are, members only with one place per entry', () => {
    expect(requestOf({ kind: 'files', paths: ['C:\\a'] })).toEqual({ kind: 'files', paths: ['C:\\a'] })
    expect(requestOf({ kind: 'files', paths: [] })).toBeNull()
    expect(requestOf({ kind: 'members', archive: 'C:\\z.zip', entries: ['a'] })).toBeNull()
    expect(requestOf({ kind: 'members', archive: 'C:\\z.zip', entries: ['a'], places: ['C:\\z.zip\\a'] })).toEqual({
      kind: 'members',
      archive: 'C:\\z.zip',
      entries: ['a'],
      places: ['C:\\z.zip\\a']
    })
    expect(requestOf(null)).toBeNull()
  })
})
