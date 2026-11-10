import { describe, expect, it, vi } from 'vitest'
import { AskDialogs, type AskAnswers } from './AskDialogs'
import type { Ask } from './asks'
import { DeleteDialog } from './DeleteDialog'
import { EmptyBinDialog } from './EmptyBinDialog'
import { MoveClashDialog } from './MoveClashDialog'
import { PermanentDeleteDialog } from './PermanentDeleteDialog'
import { FolderIconDialog } from './FolderIconDialog'
import { NoticeDialog } from './NoticeDialog'
import { UnsavedDialog } from './UnsavedDialog'

// App holds one Ask at a time; this is the table from an ask to its dialog,
// and from each answer back to App's actions.
const answers = (): AskAnswers => ({
  dismiss: vi.fn(),
  unsavedNames: ['a.txt'],
  runDelete: vi.fn(),
  runDeleteMany: vi.fn(),
  runMove: vi.fn(),
  runRename: vi.fn(),
  leave: vi.fn(),
  discardAll: vi.fn(),
  saveAllThen: vi.fn(),
  discardTabBuffers: vi.fn(),
  forceCloseTab: vi.fn(),
  answerReload: vi.fn(),
  runInstall: vi.fn(),
  setFolderIcon: vi.fn(),
  folderIconFromFile: vi.fn(),
  runBinRestore: vi.fn(),
  runBinDelete: vi.fn(),
  runBinEmpty: vi.fn()
})

interface El {
  type: unknown
  props: Record<string, unknown> & {
    onDelete?: () => void
    onDiscard?: () => void
    onClose?: () => void
    onReload?: () => void
    onKeepBoth?: () => void
    onReplace?: () => void
    onEmpty?: () => void
  }
}
const draw = (ask: Ask, layer: 'under' | 'over', a = answers()): El | null =>
  AskDialogs({ ask, layer, answers: a }) as El | null

const del: Ask = { kind: 'delete', path: 'C:/a', name: 'a', isFolder: false }

describe('AskDialogs', () => {
  it('draws each ask in the layer it always sat in', () => {
    expect(draw(del, 'under')?.type).toBe(DeleteDialog)
    expect(draw(del, 'over')).toBeNull()
    expect(draw({ kind: 'failed', message: 'x' }, 'over')?.type).toBe(NoticeDialog)
    expect(draw({ kind: 'failed', message: 'x' }, 'under')).toBeNull()
    expect(draw({ kind: 'close-tab', id: 't', names: ['a'] }, 'over')?.type).toBe(UnsavedDialog)
  })

  it('a delete answer runs the delete', () => {
    const a = answers()
    draw(del, 'under', a)?.props.onDelete?.()
    expect(a.runDelete).toHaveBeenCalledWith('C:/a')
  })

  it('the window close discards, clears the ask, then leaves (an install carried through)', () => {
    const a = answers()
    const el = draw({ kind: 'close-dirty', then: 'install' }, 'under', a)
    expect(el?.props.names).toEqual(['a.txt'])
    el?.props.onDiscard?.()
    expect(a.discardAll).toHaveBeenCalled()
    expect(a.dismiss).toHaveBeenCalled()
    expect(a.leave).toHaveBeenCalledWith('install')
  })

  it('a changed file answers the reload and clears the ask', () => {
    const a = answers()
    draw({ kind: 'file-changed', path: 'C:/n.txt', name: 'n.txt' }, 'under', a)?.props.onReload?.()
    expect(a.answerReload).toHaveBeenCalledWith('C:/n.txt', true)
    expect(a.dismiss).toHaveBeenCalled()
  })

  // THE RECYCLE BIN'S ASKS (Recycle Bin, D13 to D15).
  it('Delete permanently asks with the names, and the answer deletes those paths', () => {
    const a = answers()
    const el = draw({ kind: 'bin-delete', paths: ['p1'], names: ['a.txt'] }, 'under', a)
    expect(el?.type).toBe(PermanentDeleteDialog)
    expect(el?.props.names).toEqual(['a.txt'])
    el?.props.onDelete?.()
    expect(a.runBinDelete).toHaveBeenCalledWith(['p1'])
    expect(draw({ kind: 'bin-delete', paths: ['p1'], names: ['a'] }, 'over')).toBeNull()
  })

  it('Empty asks with the count when the bin is open, and the answer empties', () => {
    const a = answers()
    const el = draw({ kind: 'bin-empty', count: 12 }, 'under', a)
    expect(el?.type).toBe(EmptyBinDialog)
    expect(el?.props.count).toBe(12)
    el?.props.onEmpty?.()
    expect(a.runBinEmpty).toHaveBeenCalled()
  })

  it('a Restore clash reuses the move clash dialog: Keep both and Replace restore with that mode', () => {
    const a = answers()
    const el = draw({ kind: 'bin-clash', paths: ['p1', 'p2'], names: ['a', 'b'] }, 'under', a)
    expect(el?.type).toBe(MoveClashDialog)
    expect(el?.props.names).toEqual(['a', 'b'])
    el?.props.onKeepBoth?.()
    expect(a.runBinRestore).toHaveBeenCalledWith(['p1', 'p2'], 'keep-both')
    el?.props.onReplace?.()
    expect(a.runBinRestore).toHaveBeenCalledWith(['p1', 'p2'], 'replace')
  })

  it('a rename clash keeps both', () => {
    const a = answers()
    draw({ kind: 'clash', path: 'C:/a', name: 'b', suggestion: 'b (2)' }, 'over', a)?.props.onKeepBoth?.()
    expect(a.runRename).toHaveBeenCalledWith('C:/a', 'b', 'keep-both')
  })

  it('the folder icon picker sets every path, or resets them, then clears the ask', () => {
    const a = answers()
    const ask: Ask = { kind: 'folder-icon', paths: ['C:/a', 'C:/b'], name: '2 folders' }
    const el = draw(ask, 'under', a) as El & { props: { onPick: (n: string) => void; onReset: () => void } }
    expect(el.type).toBe(FolderIconDialog)
    expect(draw(ask, 'over')).toBeNull()
    el.props.onPick('camera')
    expect(a.setFolderIcon).toHaveBeenLastCalledWith(['C:/a', 'C:/b'], { set: 'camera' })
    el.props.onReset()
    expect(a.setFolderIcon).toHaveBeenLastCalledWith(['C:/a', 'C:/b'], null)
    expect(a.dismiss).toHaveBeenCalledTimes(2)
  })

  it('From a file... hands App the ask and leaves the picker up', () => {
    const a = answers()
    const ask: Ask = { kind: 'folder-icon', paths: ['C:/a'], name: 'a' }
    const el = draw(ask, 'under', a) as El & { props: { onFromFile: () => void } }
    el.props.onFromFile()
    expect(a.folderIconFromFile).toHaveBeenCalledWith(ask)
    expect(a.setFolderIcon).not.toHaveBeenCalled()
    expect(a.dismiss).not.toHaveBeenCalled()
  })
})
