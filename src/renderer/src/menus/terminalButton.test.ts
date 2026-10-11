import { describe, expect, it, vi } from 'vitest'
import type { MenuItem } from '../components/ContextMenu'
import {
  terminalButtonMenu,
  type TerminalButtonMenuContext,
  type TermEntry
} from './terminalButton'

const labels = (items: MenuItem[]): string[] => items.map((i) => i.label)

const ctx = (
  terms: TermEntry[],
  over: Partial<TerminalButtonMenuContext> = {}
): TerminalButtonMenuContext => ({
  terms,
  pickTerm: vi.fn(),
  newTerm: vi.fn(),
  splitTermId: vi.fn(),
  termSplit: vi.fn(),
  closeTermId: vi.fn(),
  closeTerm: vi.fn(),
  ...over
})

const one: TermEntry[] = [{ id: 'a', label: 'PowerShell', current: true, shown: true }]
const two: TermEntry[] = [
  { id: 'a', label: 'PowerShell', current: true, shown: true },
  { id: 'b', label: 'bash', current: false, shown: false }
]

describe('terminalButtonMenu', () => {
  it('one shell', () => {
    const c = ctx(one)
    const items = terminalButtonMenu(c)
    expect(labels(items)).toEqual(['Open new terminal', 'Open in split view', 'Close terminal'])
    expect(items[1].children).toBeUndefined()
    items[1].onPick?.()
    expect(c.termSplit).toHaveBeenCalled()
  })

  it('no shell yet: nothing to close', () => {
    expect(labels(terminalButtonMenu(ctx([], { closeTerm: null })))).toEqual([
      'Open new terminal',
      'Open in split view'
    ])
  })

  it('several shells: listed, and split and close become submenus', () => {
    const c = ctx(two)
    const items = terminalButtonMenu(c)
    expect(labels(items)).toEqual([
      'PowerShell',
      'bash',
      'Open new terminal',
      'Open in split view',
      'Close terminal'
    ])
    const split = items[3].children!
    expect(labels(split)).toEqual(['PowerShell', 'bash'])
    expect(split.every((s) => s.keepOpen)).toBe(true)
    split[1].onPick?.()
    expect(c.splitTermId).toHaveBeenCalledWith('b')
    expect(labels(items[4].children!)).toEqual(['PowerShell', 'bash'])
    items[4].children![0].onPick?.()
    expect(c.closeTermId).toHaveBeenCalledWith('a')
    items[1].onPick?.()
    expect(c.pickTerm).toHaveBeenCalledWith('b')
  })
})
