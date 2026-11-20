import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MENU_PANEL, MENU_ROW, stepRow } from './menuLook'

// One popup-menu look (#522): the right-click menu and the player's cog menu.
const src = (f: string): string => readFileSync(join(__dirname, f), 'utf8')

describe('the one menu look', () => {
  it('is the right-click menu\'s: radius 2, 28 px rows, 12 px type, a divider above each row', () => {
    expect(MENU_PANEL).toContain('rounded-[2px]')
    expect(MENU_ROW).toContain('h-[28px]')
    expect(MENU_ROW).toContain('text-[12px]')
    expect(MENU_ROW).toContain('border-t')
    expect(MENU_ROW).toContain('first:border-t-0')
  })

  it('both menus build their panel and rows from it, with none of the old sizes left', () => {
    for (const f of ['ContextMenu.tsx', 'PlayerMenu.tsx']) {
      const s = src(f)
      expect(s, f).toContain('MENU_PANEL')
      expect(s, f).toContain('MENU_ROW')
      expect(s, f).not.toMatch(/rounded-\[6px\]|h-\[30px\]|text-\[12\.5px\]|my-1 h-px/)
    }
  })

  it('Up and Down walk the rows and wrap; with no row focused Down takes the first, Up the last', () => {
    expect(stepRow(3, 0, 'ArrowDown')).toBe(1)
    expect(stepRow(3, 2, 'ArrowDown')).toBe(0)
    expect(stepRow(3, 0, 'ArrowUp')).toBe(2)
    expect(stepRow(3, -1, 'ArrowDown')).toBe(0)
    expect(stepRow(3, -1, 'ArrowUp')).toBe(2)
    expect(stepRow(0, -1, 'ArrowDown')).toBe(-1)
  })

  it('the player menu keeps its drill-down and walks its rows with the arrows', () => {
    const s = src('PlayerMenu.tsx')
    expect(s).toContain('data-menu-back')
    expect(s).toContain('stepRow')
    expect(s).toContain('onKeyDown')
  })
})