import { describe, expect, it } from 'vitest'
import { rootName, tabList } from './tabs'

/** What main's `isRoot` does, in the small: case and a trailing separator do
 *  not make a second folder. */
const same = (a: string, b: string): boolean =>
  a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase()

describe('rootName', () => {
  it('names a folder by its own name', () => {
    expect(rootName('C:\\Users\\Max\\Videos')).toBe('Videos')
    expect(rootName('C:\\Users\\Max\\Videos\\')).toBe('Videos')
    expect(rootName('D:/media/films')).toBe('films')
  })

  it('keeps the whole path for a drive root, which has no name of its own', () => {
    expect(rootName('C:\\')).toBe('C:\\')
    expect(rootName('X:')).toBe('X:')
  })
})

describe('tabList', () => {
  it('lists the roots in the order the PC opened them, marking the phone own', () => {
    const list = tabList(['C:\\a\\Films', 'C:\\b\\Photos'], 'C:\\b\\photos\\', same)
    expect(list).toEqual([
      { root: 'C:\\a\\Films', name: 'Films', current: false },
      { root: 'C:\\b\\Photos', name: 'Photos', current: true }
    ])
  })

  it('marks nothing when the phone root is not open any more', () => {
    const list = tabList(['C:\\a\\Films'], 'C:\\gone', same)
    expect(list.every((t) => !t.current)).toBe(true)
  })

  it('is empty when the PC has nothing open', () => {
    expect(tabList([], 'C:\\a', same)).toEqual([])
  })
})
