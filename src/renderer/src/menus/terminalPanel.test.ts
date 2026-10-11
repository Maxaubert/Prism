import { describe, expect, it, vi } from 'vitest'
import { terminalPanelMenu, type TerminalPanelMenuContext } from './terminalPanel'

const build = (
  over: Partial<TerminalPanelMenuContext> = {}
): ReturnType<typeof terminalPanelMenu> =>
  terminalPanelMenu({
    full: false,
    edge: 'bottom',
    link: null,
    selection: '',
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onFind: vi.fn(),
    onDockPick: vi.fn(),
    onRemoveFromSplit: vi.fn(),
    onKill: vi.fn(),
    ...over
  })
const labels = (items: Array<{ label: string }>): string[] => items.map((i) => i.label)

describe('terminalPanelMenu', () => {
  it('in split view: paste, find, the split rows, close', () => {
    expect(labels(build())).toEqual([
      'Paste',
      'Find',
      'Split view position',
      'Remove from split view',
      'Close terminal'
    ])
  })
  it('in full view the split rows wait', () => {
    expect(labels(build({ full: true }))).toEqual(['Paste', 'Find', 'Close terminal'])
  })
  it('a link and a selection put their copy rows first, link before text', () => {
    const onCopy = vi.fn()
    const items = build({ link: 'https://x.test', selection: 'hello', onCopy })
    expect(labels(items)).toEqual([
      'Copy link',
      'Copy',
      'Paste',
      'Find',
      'Split view position',
      'Remove from split view',
      'Close terminal'
    ])
    items[0].onPick?.()
    expect(onCopy).toHaveBeenLastCalledWith('https://x.test')
    items[1].onPick?.()
    expect(onCopy).toHaveBeenLastCalledWith('hello')
  })
  it('the position submenu lists the four edges', () => {
    const onDockPick = vi.fn()
    const items = build({ edge: 'right', onDockPick })
    const edges = items.find((i) => i.label === 'Split view position')?.children ?? []
    expect(labels(edges)).toEqual(['Left', 'Right', 'Top', 'Bottom'])
    edges[2].onPick?.()
    expect(onDockPick).toHaveBeenCalledWith('top')
  })
})
