import { afterEach, describe, expect, it } from 'vitest'
import { pathKey } from '@shared/path'
import {
  FOLDER_ICONS_KEY,
  folderIconOf,
  followFolderIcons,
  followMoves,
  iconFileIds,
  parseFolderIcons,
  readFolderIcons,
  setFolderIcons,
  withoutMissingFiles,
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

  it('a stale icon at the destination goes: what lands there brings its own, or none', () => {
    // "Photos" was deleted (its entry kept for an undo), then "Old" renamed
    // to "Photos": the newcomer must not wear the deleted folder's camera,
    // nor its sub-folders' icons (review of the folder icons, 2026-10-31).
    const before = map({ 'C:/Photos': { set: 'camera' }, 'C:/Photos/2024': { set: 'star' }, 'C:/Photography': { set: 'heart' } })
    const after = followMoves(before, [{ from: 'C:/Old', to: 'C:/Photos' }])
    expect(Object.fromEntries(after)).toEqual(Object.fromEntries(map({ 'C:/Photography': { set: 'heart' } })))
    // A replace: the newcomer's own icon wins over the one it replaced.
    const replaced = followMoves(map({ 'C:/a/x': { set: 'star' }, 'C:/b/x': { set: 'camera' } }), [
      { from: 'C:/a/x', to: 'C:/b/x' }
    ])
    expect(Object.fromEntries(replaced)).toEqual(Object.fromEntries(map({ 'C:/b/x': { set: 'star' } })))
  })

  it('moves read the map as it was: a chain does not wipe what it just placed', () => {
    const before = map({ 'C:/a': { set: 'star' }, 'C:/b': { set: 'heart' } })
    const after = followMoves(before, [
      { from: 'C:/a', to: 'C:/b' },
      { from: 'C:/b', to: 'C:/c' }
    ])
    expect(Object.fromEntries(after)).toEqual(Object.fromEntries(map({ 'C:/b': { set: 'star' }, 'C:/c': { set: 'heart' } })))
  })

  it('a case-only rename keeps the icon', () => {
    const before = map({ 'C:/Photos': { set: 'camera' } })
    expect(followMoves(before, [{ from: 'C:/Photos', to: 'C:/photos' }])).toBe(before)
  })

  it('followFolderIcons writes the moved keys to the pref', () => {
    setFolderIcons(['C:/a/b'], { set: 'star' })
    followFolderIcons([{ from: 'C:/a', to: 'C:/z' }])
    expect(folderIconOf(readFolderIcons(), 'C:/z/b')).toEqual({ set: 'star' })
    expect(JSON.parse(localStorage.getItem(FOLDER_ICONS_KEY) ?? '{}')).toEqual({ [pathKey('C:/z/b')]: { set: 'star' } })
  })
})

describe('pictures from a file (PR 3)', () => {
  const B = 'b'.repeat(64)

  it('names each kept picture the map uses, once', () => {
    const m = map({ 'C:/a': { file: HASH }, 'C:/b': { file: HASH }, 'C:/c': { file: B }, 'C:/d': { set: 'camera' } })
    expect(iconFileIds(m).sort()).toEqual([HASH, B])
    expect(iconFileIds(new Map())).toEqual([])
  })

  it('drops the entries whose copy main no longer has, and nothing else', () => {
    const m = map({ 'C:/a': { file: HASH }, 'C:/c': { file: B }, 'C:/d': { set: 'camera' } })
    const next = withoutMissingFiles(m, new Map([[B, 'data:']]))
    expect([...next.keys()]).toEqual([pathKey('C:/c'), pathKey('C:/d')])
    const all = new Map([
      [HASH, 'data:'],
      [B, 'data:']
    ])
    expect(withoutMissingFiles(m, all)).toBe(m)
  })
})
