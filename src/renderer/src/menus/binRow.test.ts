import { describe, expect, it, vi } from 'vitest'
import { binPlaceMenu, binRowMenu } from './binRow'

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
  ...over
})

describe('binRowMenu (a row of the bin list, D12 and D16; the actions join in the next stage)', () => {
  it('one file: Open, Show in preview, Copy original path', () => {
    expect(binRowMenu(rowCtx()).map((i) => i.label)).toEqual(['Open', 'Show in preview', 'Copy original path'])
  })
  it('one folder: it is never opened (D10), only Copy original path', () => {
    expect(binRowMenu(rowCtx({ entry: folder })).map((i) => i.label)).toEqual(['Copy original path'])
  })
  it('several marked: only what acts on all of them', () => {
    const paths = ['a', 'b', 'c']
    expect(binRowMenu(rowCtx({ paths })).map((i) => i.label)).toEqual(['Copy original paths'])
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
