import { afterEach, describe, expect, it } from 'vitest'
import { pathKey } from '@shared/path'
import {
  FOLDER_ICONS_KEY,
  folderIconOf,
  followFolderIcons,
  followMoves,
  parseFolderIcons,
  readFolderIcons,
  setFolderIcons,
  type FolderIconChoice
} from './folderIcons'

const HASH = 'a'.repeat(64)
afterEach(() => localStorage.removeItem(FOLDER_ICONS_KEY))

const map = (entries: Record<string, FolderIconChoice>) => new Map(Object.entries(entries).map(([k, v]) => [pathKey(k), v]))

describe('folder icons store', () => {
  it('parse keeps good entries keyed by pathKey and drops junk', () => {
    const m = parseFolderIcons(
      JSON.stringify({
        'C:/Photos': { set: 'camera' },
        'D:/Art': { file: HASH },
        'C:/bad1': { set: 'Not A Name!' },
        'C:/bad2': { file: 'nothex' },
        'C:/bad3': 'camera',
        'C:/bad4': null
      })
    )
    expect([...m.keys()]).toEqual([pathKey('C:/Photos'), pathKey('D:/Art')])
    expect(parseFolderIcons('not json').size).toBe(0)
    expect(parseFolderIcons('[1,2]').size).toBe(0)
    expect(parseFolderIcons(null).size).toBe(0)
  })

  it('set, look up (any case, any slashes, a trailing one), reset', () => {
    setFolderIcons(['C:/Users/Me/Photos'], { set: 'camera' })
    const m = readFolderIcons()
    expect(folderIconOf(m, 'c:\\users\\me\\photos\\')).toEqual({ set: 'camera' })
    expect(folderIconOf(m, 'C:/Users/Me/Photos')).toEqual({ set: 'camera' })
    expect(folderIconOf(m, 'C:/Users/Me')).toBeUndefined()
    setFolderIcons(['C:/Users/Me/Photos'], null)
    expect(readFolderIcons().size).toBe(0)
  })

  it('one pick sets several folders at once', () => {
    setFolderIcons(['C:/a', 'C:/b'], { set: 'star' })
    expect(folderIconOf(readFolderIcons(), 'C:/a')).toEqual({ set: 'star' })
    expect(folderIconOf(readFolderIcons(), 'C:/b')).toEqual({ set: 'star' })
  })

  it('keeps the same Map while nothing changed (rows read it every render)', () => {
    setFolderIcons(['C:/a'], { set: 'star' })
    expect(readFolderIcons()).toBe(readFolderIcons())
  })

  it('an empty map does no lookup at all', () => {
    const empty = new Map<string, FolderIconChoice>()
    const spy = { get: 0 }
    const watched = new Proxy(empty, {
      get(target, prop) {
        if (prop === 'get') spy.get += 1
        const v = Reflect.get(target, prop, target)
        return typeof v === 'function' ? v.bind(target) : v
      }
    })
    expect(folderIconOf(watched, 'C:/a')).toBeUndefined()
    expect(spy.get).toBe(0)
  })

  it('a rename or move rewrites the key and every key under it, and nothing else', () => {
    const before = map({
      'C:/trips': { set: 'plane' },
      'C:/trips/2024': { set: 'camera' },
      'C:/tripsother': { set: 'star' },
      'D:/x': { file: HASH }
    })
    const after = followMoves(before, [{ from: 'C:/trips', to: 'E:/archive/trips' }])
    expect(after).not.toBe(before)
    expect(Object.fromEntries(after)).toEqual(
      Object.fromEntries(
        map({
          'E:/archive/trips': { set: 'plane' },
          'E:/archive/trips/2024': { set: 'camera' },
          'C:/tripsother': { set: 'star' },
          'D:/x': { file: HASH }
        })
      )
    )
  })

  it('a move that touches no icon returns the same map (no write)', () => {
    const before = map({ 'C:/a': { set: 'star' } })
    expect(followMoves(before, [{ from: 'C:/b', to: 'C:/c' }])).toBe(before)
    expect(followMoves(before, [])).toBe(before)
    const empty = new Map<string, FolderIconChoice>()
    expect(followMoves(empty, [{ from: 'C:/a', to: 'C:/z' }])).toBe(empty)
  })

  it('several moves at once, each its own', () => {
    const before = map({ 'C:/a': { set: 'star' }, 'C:/b': { set: 'heart' } })
    const after = followMoves(before, [
      { from: 'C:/a', to: 'D:/a' },
      { from: 'C:/b', to: 'D:/b' }
    ])
    expect([...after.keys()].sort()).toEqual([pathKey('D:/a'), pathKey('D:/b')])
  })

  it('followFolderIcons writes the moved keys to the pref', () => {
    setFolderIcons(['C:/a/b'], { set: 'star' })
    followFolderIcons([{ from: 'C:/a', to: 'C:/z' }])
    expect(folderIconOf(readFolderIcons(), 'C:/z/b')).toEqual({ set: 'star' })
    expect(JSON.parse(localStorage.getItem(FOLDER_ICONS_KEY) ?? '{}')).toEqual({ [pathKey('C:/z/b')]: { set: 'star' } })
  })
})
