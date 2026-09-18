import { beforeEach, describe, expect, it } from 'vitest'
import {
  QUICK_ACCESS_KEY,
  moveQuickAccess,
  parseQuickAccess,
  pinQuickAccess,
  readQuickAccess,
  reorderedQuickAccess,
  sameQuickAccessPath,
  seedQuickAccess,
  unpinQuickAccess,
  withQuickAccessPins,
  type QuickAccessPin
} from './quickAccess'

const home: QuickAccessPin = { path: 'C:\\Users\\Admin', label: 'Home', isFolder: true }
const docs: QuickAccessPin = {
  path: 'C:\\Users\\Admin\\Documents',
  label: 'Documents',
  isFolder: true
}
const file: QuickAccessPin = { path: 'D:\\Work\\notes.txt', label: 'notes.txt', isFolder: false }
beforeEach(() => localStorage.clear())

describe('Quick access persistence', () => {
  it('seeds defaults only once, after asynchronous locations arrive', () => {
    seedQuickAccess([])
    expect(localStorage.getItem(QUICK_ACCESS_KEY)).toBeNull()
    seedQuickAccess([home, docs])
    expect(readQuickAccess()).toEqual([home, docs])
    seedQuickAccess([file])
    expect(readQuickAccess()).toEqual([home, docs])
  })

  it('keeps an explicitly emptied rail empty when defaults hydrate again', () => {
    seedQuickAccess([home, docs])
    unpinQuickAccess(home.path)
    unpinQuickAccess(docs.path)
    expect(localStorage.getItem(QUICK_ACCESS_KEY)).toBe('[]')
    seedQuickAccess([home, docs])
    expect(readQuickAccess()).toEqual([])
  })

  it('round trips mixed file and folder pins and their deliberate order', () => {
    seedQuickAccess([home, docs])
    pinQuickAccess([file])
    moveQuickAccess(file.path, home.path)
    expect(readQuickAccess()).toEqual([file, home, docs])
    seedQuickAccess([home, docs])
    expect(parseQuickAccess(localStorage.getItem(QUICK_ACCESS_KEY))).toEqual([file, home, docs])
    unpinQuickAccess('d:/work/NOTES.txt')
    expect(readQuickAccess()).toEqual([home, docs])
  })

  it('does not replace existing profile pins when first-run defaults arrive late', () => {
    pinQuickAccess([file])
    seedQuickAccess([home, docs])
    expect(readQuickAccess()).toEqual([file])
  })

  it('deduplicates Windows casing, slash spelling and trailing separators without moving an existing pin', () => {
    seedQuickAccess([home, docs])
    pinQuickAccess([{ ...home, path: 'c:/USERS/admin/', label: 'renamed label' }, file])
    expect(readQuickAccess()).toEqual([home, docs, file])
    expect(sameQuickAccessPath('C:\\', 'c:/')).toBe(true)
    expect(sameQuickAccessPath('\\\\server\\share\\', '//SERVER/share')).toBe(true)
  })

  it('filters malformed entries on hydration without silently restoring removed defaults', () => {
    const saved = JSON.stringify([
      home,
      { ...home, path: 'c:/users/Admin/' },
      { path: 'relative', label: 'invalid', isFolder: true },
      { ...docs, isFolder: 'yes' },
      { ...file, label: '' },
      file
    ])
    localStorage.setItem(QUICK_ACCESS_KEY, saved)
    expect(readQuickAccess()).toEqual([home, file])
    localStorage.setItem(QUICK_ACCESS_KEY, '{broken')
    seedQuickAccess([home])
    expect(readQuickAccess()).toEqual([])
  })
})

describe('Quick access ordering', () => {
  it('inserts dropped files before a stable target in supplied order', () => {
    const extra = { ...file, path: 'D:\\Work\\second.txt', label: 'second.txt' }
    expect(withQuickAccessPins([home, docs], [file, extra], docs.path)).toEqual([
      home,
      file,
      extra,
      docs
    ])
  })

  it('moves in both directions and to the end without duplicating a row', () => {
    expect(reorderedQuickAccess([home, docs, file], file.path, home.path)).toEqual([
      file,
      home,
      docs
    ])
    expect(reorderedQuickAccess([home, docs, file], home.path, file.path)).toEqual([
      docs,
      home,
      file
    ])
    expect(reorderedQuickAccess([home, docs, file], home.path)).toEqual([docs, file, home])
  })

  it('ignores unknown sources and dropping a pin on itself', () => {
    expect(reorderedQuickAccess([home, docs], 'D:\\unknown', home.path)).toEqual([home, docs])
    expect(reorderedQuickAccess([home, docs], home.path, 'c:/users/admin/')).toEqual([home, docs])
  })
})
