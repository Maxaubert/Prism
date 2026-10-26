import { describe, expect, it, vi } from 'vitest'
import { AskDialogs, type AskAnswers } from './AskDialogs'
import type { Ask } from './asks'
import { DeleteDialog } from './DeleteDialog'
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
  applyReroot: vi.fn(),
  answerReload: vi.fn(),
  runInstall: vi.fn()
})

interface El {
  type: unknown
  props: Record<string, unknown> & {
    onDelete?: () => void
    onDiscard?: () => void
    onClose?: () => void
    onReload?: () => void
    onKeepBoth?: () => void
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

  it('a rename clash keeps both', () => {
    const a = answers()
    draw({ kind: 'clash', path: 'C:/a', name: 'b', suggestion: 'b (2)' }, 'over', a)?.props.onKeepBoth?.()
    expect(a.runRename).toHaveBeenCalledWith('C:/a', 'b', 'keep-both')
  })
})
