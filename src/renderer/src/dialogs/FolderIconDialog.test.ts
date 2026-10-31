import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { FolderIconDialog } from './FolderIconDialog'
import { iconStatus } from '../components/iconGrid/pickerText'
import { labels, pick, specOf } from './testing'

const open = (over: Partial<Parameters<typeof FolderIconDialog>[0]> = {}) => {
  const answers = { onPick: vi.fn(), onReset: vi.fn(), onFromFile: vi.fn(), onCancel: vi.fn() }
  const el = FolderIconDialog({ name: 'Photos', ...answers, ...over })
  return { s: specOf(el), el, ...answers }
}

describe('FolderIconDialog', () => {
  it('names the folder, has the search field and the grid, and three buttons', () => {
    const { s, el } = open()
    expect(s.title).toBe('Icon for Photos')
    const body = renderToStaticMarkup((el.props as { body: ReactElement }).body)
    expect(body).toContain('aria-label="Search icons"')
    expect(body).toContain('role="listbox"')
    expect(body).toContain('aria-label="Icons"')
    expect(labels(s)).toEqual(['Cancel', 'Reset to default', 'From a file...'])
    expect(s.choices.some((c) => c.primary)).toBe(false)
  })

  it('several folders read as a count', () => {
    expect(open({ name: '3 folders' }).s.title).toBe('Icon for 3 folders')
  })

  it('each button gives its answer', () => {
    const { s, onReset, onFromFile, onCancel } = open()
    pick(s, 'Reset to default').onPick()
    expect(onReset).toHaveBeenCalledTimes(1)
    pick(s, 'From a file...').onPick()
    expect(onFromFile).toHaveBeenCalledTimes(1)
    expect(onReset).toHaveBeenCalledTimes(1)
    pick(s, 'Cancel').onPick()
    s.onCancel()
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('the status line counts icons, then matches', () => {
    expect(iconStatus(2024, 2024, false)).toBe('2,024 icons')
    expect(iconStatus(2024, 14, true)).toBe('14 matches')
    expect(iconStatus(2024, 1, true)).toBe('1 match')
    expect(iconStatus(2024, 0, true)).toBe('No icon matches')
  })
})
