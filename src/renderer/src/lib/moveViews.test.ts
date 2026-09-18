import { describe, expect, it } from 'vitest'
import { newTab } from './tabs'
import { captureMoveViews, movedPath, releaseMoveViews, restoreMoveViews } from './moveViews'

const tab = (id: string, path: string) =>
  newTab(
    {
      root: 'C:\\work',
      files: [{ path, name: 'page.jpg', kind: 'image', ext: '.jpg', size: 1, mtimeMs: 1 }],
      index: 0
    },
    id
  )

describe('viewers held by a file move', () => {
  it('restores every source preview and pinned file after a clash or refusal', () => {
    const a = tab('a', 'C:\\work\\book\\page.jpg')
    const b = tab('b', 'C:\\work\\other.jpg')
    b.panes = [{ id: 'pin', path: a.files[0].path, dir: 'right' }]
    const tabs = [a, b]
    const held = captureMoveViews(tabs, ['C:\\work\\book'])
    const released = releaseMoveViews(tabs, held)
    expect(released[0].index).toBe(-1)
    expect(released[1].index).toBe(0)
    expect(released[1].panes).toEqual([])
    expect(restoreMoveViews(released, held, [])).toEqual(tabs)
  })

  it('follows moved folder prefixes for live and pinned viewers without changing roots', () => {
    const a = tab('a', 'C:\\work\\book\\page.jpg')
    a.panes = [{ id: 'pin', path: 'C:\\work\\book\\film.mp4', dir: 'right' }]
    const held = captureMoveViews([a], ['C:\\work\\book'])
    const [restored] = restoreMoveViews(releaseMoveViews([a], held), held, [
      {
        from: 'C:\\work\\book',
        to: 'D:\\other\\book (2)'
      }
    ])
    expect(restored.index).toBe(0)
    expect(restored.files[0].path).toBe('D:\\other\\book (2)\\page.jpg')
    expect(restored.panes[0].path).toBe('D:\\other\\book (2)\\film.mp4')
    expect(restored.root).toBe(a.root)
  })

  it('does not release or restore a viewer the user navigated away from', () => {
    const a = tab('a', 'C:\\work\\page.jpg')
    const held = captureMoveViews([a], [a.files[0].path])
    const next = tab('a', 'C:\\work\\next.jpg')
    expect(releaseMoveViews([next], held)[0].index).toBe(0)
    expect(
      restoreMoveViews([next], held, [{ from: a.files[0].path, to: 'C:\\work\\dest\\page.jpg' }])[0]
        .files[0].path
    ).toBe(next.files[0].path)
    const [released] = releaseMoveViews([a], held)
    const navigated = { ...released, browse: { ...released.browse, path: 'D:\\new' } }
    const restored = restoreMoveViews([navigated], held, [])[0]
    expect(restored.index).toBe(0)
    expect(restored.browse.path).toBe('D:\\new')
    expect(restoreMoveViews([], held, [])).toEqual([])
  })

  it('matches whole Windows path components case-insensitively', () => {
    const moves = [{ from: 'c:\\WORK\\book', to: 'D:\\book' }]
    expect(movedPath('C:\\work\\book\\page.jpg', moves)).toBe('D:\\book\\page.jpg')
    expect(movedPath('C:\\work\\booklet\\page.jpg', moves)).toBe('C:\\work\\booklet\\page.jpg')
  })

  it('keeps scrolling and a closed preview while restoring its released file', () => {
    const a = tab('a', 'C:\\work\\page.jpg')
    const held = captureMoveViews([a], [a.files[0].path])
    const [released] = releaseMoveViews([a], held)
    const scrolled = {
      ...released,
      browse: {
        ...released.browse,
        preview: false,
        history: released.browse.history.map((location) => ({ ...location, scrollTop: 200 }))
      }
    }
    const [restored] = restoreMoveViews([scrolled], held, [])
    expect(restored.index).toBe(0)
    expect(restored.browse).toBe(scrolled.browse)
    expect(restored.browse.preview).toBe(false)
    expect(restored.browse.history[0].scrollTop).toBe(200)
  })

  it('restores both viewers when an unrelated concurrent move finishes first', () => {
    const a = tab('a', 'C:\\work\\a\\page.jpg')
    const b = tab('b', 'C:\\work\\b\\page.jpg')
    a.panes = [{ id: 'a-pin', path: 'C:\\work\\a\\movie.mp4', dir: 'right' }]
    b.panes = [{ id: 'b-pin', path: 'C:\\work\\b\\movie.mp4', dir: 'right' }]
    const heldA = captureMoveViews([a, b], ['C:\\work\\a'])
    const releasedA = releaseMoveViews([a, b], heldA)
    const heldB = captureMoveViews(releasedA, ['C:\\work\\b'])
    const releasedBoth = releaseMoveViews(releasedA, heldB)
    const restoredB = restoreMoveViews(releasedBoth, heldB, [{ from: 'C:\\work\\b', to: 'D:\\b' }])
    expect(restoredB[0]).toBe(releasedA[0])
    const restored = restoreMoveViews(restoredB, heldA, [{ from: 'C:\\work\\a', to: 'D:\\a' }])
    expect(restored.map((item) => item.index)).toEqual([0, 0])
    expect(restored[0].files[0].path).toBe('D:\\a\\page.jpg')
    expect(restored[0].panes[0].path).toBe('D:\\a\\movie.mp4')
    expect(restored[1].files[0].path).toBe('D:\\b\\page.jpg')
    expect(restored[1].panes[0].path).toBe('D:\\b\\movie.mp4')
  })

  it('restores the held file after a sibling moves within the same tab list', () => {
    const a = tab('a', 'C:\\work\\a.jpg')
    a.files.push(tab('unused', 'C:\\work\\b.jpg').files[0])
    const heldA = captureMoveViews([a], ['C:\\work\\a.jpg'])
    const releasedA = releaseMoveViews([a], heldA)
    const heldB = captureMoveViews(releasedA, ['C:\\work\\b.jpg'])
    const restoredB = restoreMoveViews(releasedA, heldB, [
      {
        from: 'C:\\work\\b.jpg',
        to: 'D:\\b.jpg'
      }
    ])
    expect(restoredB[0].files).not.toBe(a.files)
    expect(restoredB[0].files[0]).toBe(a.files[0])
    // A list may also have been resorted while the held viewer was detached.
    const reordered = [{ ...restoredB[0], files: restoredB[0].files.toReversed() }]
    const [restored] = restoreMoveViews(reordered, heldA, [
      {
        from: 'C:\\work\\a.jpg',
        to: 'D:\\a.jpg'
      }
    ])
    expect(restored.index).toBe(1)
    expect(restored.files[restored.index].path).toBe('D:\\a.jpg')
    expect(restored.files[0].path).toBe('D:\\b.jpg')
  })
})
