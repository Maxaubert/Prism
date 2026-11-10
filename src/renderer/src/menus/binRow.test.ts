import { describe, expect, it, vi } from 'vitest'
import { binEmptySpaceMenu, binPlaceMenu, binRowMenu } from './binRow'

const build = (
  over: Partial<Parameters<typeof binPlaceMenu>[0]> = {}
): ReturnType<typeof binPlaceMenu> =>
  binPlaceMenu({ onOpen: vi.fn(), onOpenNewTab: vi.fn(), onEmpty: vi.fn(), ...over })

describe('binPlaceMenu (the sidebar Recycle Bin row, D19)', () => {
  it('has Open, Open in new tab, Empty Recycle Bin, in that order, and nothing else', () => {
    expect(build().map((i) => i.label)).toEqual(['Open', 'Open in new tab', 'Empty Recycle Bin'])
  })
  it('has no pin rows: the row is not a pin', () => {
    const labels = build().map((i) => i.label)
    expect(labels.some((l) => /pin|properties|copy path/i.test(l))).toBe(false)
  })
  it('each row calls its own action', () => {
    const onOpen = vi.fn()
    const onOpenNewTab = vi.fn()
    const onEmpty = vi.fn()
    const items = build({ onOpen, onOpenNewTab, onEmpty })
    items[0].onPick?.()
    items[1].onPick?.()
    items[2].onPick?.()
    expect([onOpen, onOpenNewTab, onEmpty].map((f) => f.mock.calls.length)).toEqual([1, 1, 1])
  })
  it('a row whose action is absent is disabled, not hidden', () => {
    const items = build({ onOpenNewTab: undefined, onEmpty: undefined })
    expect(items.filter((i) => i.disabled).map((i) => i.label)).toEqual([
      'Open in new tab',
      'Empty Recycle Bin'
    ])
  })
})

const viewerFile = {
  path: 'C:\\$Recycle.Bin\\S-1\\$RAB.txt',
  name: 'a.txt',
  ext: '.txt',
  kind: 'text',
  binned: { from: 'C:\\x', at: 1 }
}
const file = { path: viewerFile.path, name: 'a.txt', isFolder: false, file: viewerFile } as never
const folder = { path: 'C:\\$Recycle.Bin\\S-1\\$RCD', name: 'docs', isFolder: true } as never
const rowCtx = (
  over: Partial<Parameters<typeof binRowMenu>[0]> = {}
): Parameters<typeof binRowMenu>[0] => ({
  entry: file,
  openFile: vi.fn(),
  showInPreview: vi.fn(),
  copyOriginalPaths: vi.fn(),
  restore: vi.fn(),
  askDelete: vi.fn(),
  ...over
})

describe('binRowMenu (a row of the bin list, D12, D13, D14 and D16)', () => {
  it('one file: Open, Show in preview, Restore, Copy original path, Delete permanently', () => {
    expect(binRowMenu(rowCtx()).map((i) => i.label)).toEqual([
      'Open',
      'Show in preview',
      'Restore',
      'Copy original path',
      'Delete permanently'
    ])
  })
  it('one folder: it is never opened (D10), so Restore, Copy original path, Delete permanently', () => {
    expect(binRowMenu(rowCtx({ entry: folder })).map((i) => i.label)).toEqual([
      'Restore',
      'Copy original path',
      'Delete permanently'
    ])
  })
  it('several marked: the counts, and only what acts on all of them', () => {
    const paths = ['a', 'b', 'c']
    expect(binRowMenu(rowCtx({ paths })).map((i) => i.label)).toEqual([
      'Restore 3 items',
      'Copy original paths',
      'Delete 3 items permanently'
    ])
  })
  it('delete is the last row, as in every menu, and the danger row', () => {
    for (const c of [rowCtx(), rowCtx({ entry: folder }), rowCtx({ paths: ['a', 'b'] })]) {
      const items = binRowMenu(c)
      const last = items[items.length - 1]
      expect(last.label).toMatch(/^Delete/)
      expect(last.danger).toBe(true)
    }
  })
  it('the actions get the marked rows (one row, or all of them)', () => {
    const one = rowCtx()
    binRowMenu(one).forEach((i) => i.onPick?.())
    expect(one.restore).toHaveBeenCalledWith([viewerFile.path])
    expect(one.askDelete).toHaveBeenCalledWith([viewerFile.path])
    const paths = ['a', 'b']
    const many = rowCtx({ paths })
    binRowMenu(many).forEach((i) => i.onPick?.())
    expect(many.restore).toHaveBeenCalledWith(paths)
    expect(many.askDelete).toHaveBeenCalledWith(paths)
  })
  it('none of the write verbs of an ordinary row is ever there', () => {
    const labels = [rowCtx(), rowCtx({ entry: folder }), rowCtx({ paths: ['a', 'b'] })].flatMap((c) =>
      binRowMenu(c).map((i) => i.label)
    )
    expect(labels.some((l) => /cut|paste|rename|duplicate|pin|properties|file explorer|new tab|icon/i.test(l))).toBe(false)
  })
  it('each row calls its own action with the right thing', () => {
    const c = rowCtx()
    binRowMenu(c).forEach((i) => i.onPick?.())
    expect(c.openFile).toHaveBeenCalledWith(viewerFile)
    expect(c.showInPreview).toHaveBeenCalledWith(viewerFile)
    expect(c.copyOriginalPaths).toHaveBeenCalledWith(['C:\\$Recycle.Bin\\S-1\\$RAB.txt'])
  })
})

describe('binEmptySpaceMenu (a right press on the list, D19)', () => {
  it('is Empty Recycle Bin alone', () => {
    expect(binEmptySpaceMenu({ count: 3, onEmpty: vi.fn() }).map((i) => i.label)).toEqual(['Empty Recycle Bin'])
  })
  it('is disabled with no rows, not hidden', () => {
    expect(binEmptySpaceMenu({ count: 0, onEmpty: vi.fn() })[0].disabled).toBe(true)
    expect(binEmptySpaceMenu({ count: 2, onEmpty: vi.fn() })[0].disabled).toBeFalsy()
  })
  it('calls the action', () => {
    const onEmpty = vi.fn()
    binEmptySpaceMenu({ count: 2, onEmpty })[0].onPick?.()
    expect(onEmpty).toHaveBeenCalledOnce()
  })
})
