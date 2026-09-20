import { describe, expect, it } from 'vitest'
import { swallows } from './extractionGuard'

describe('the keyboard while the extraction window is up', () => {
  it('is left alone when there is no window', () => {
    for (const k of ['Escape', 'w', 'Delete', 'ArrowDown', 'Enter'])
      expect(swallows(false, k, false)).toBe(false)
  })

  it('swallows Escape, wherever it is aimed: the window cannot be dismissed', () => {
    expect(swallows(true, 'Escape', false)).toBe(true)
    expect(swallows(true, 'Escape', true)).toBe(true)
  })

  it('swallows what would have reached the app behind it', () => {
    // Ctrl+W closes a tab, Delete bins a file, the arrows page the folder,
    // F2 renames: none of them while the app says it is busy.
    for (const k of ['w', 'Delete', 'ArrowDown', 'ArrowUp', 'F2', 'F11', 'Backspace', 'z'])
      expect(swallows(true, k, false)).toBe(true)
  })

  it('lets the one button be worked from the keyboard', () => {
    for (const k of ['Tab', 'Enter', ' ']) expect(swallows(true, k, true)).toBe(false)
  })

  it('but not by a key aimed at the app behind the window', () => {
    for (const k of ['Tab', 'Enter', ' ']) expect(swallows(true, k, false)).toBe(true)
  })
})
