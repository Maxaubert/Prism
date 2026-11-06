import { beforeEach, describe, expect, it, vi } from 'vitest'

const record = vi.fn()
vi.mock('prism-term-core/renderer/lib/diag', () => ({ record }))

const { logNote, noteLevel, noteLine } = await import('./noteLog')

beforeEach(() => record.mockReset())

describe('every note the user is shown is in the log (owner, 2026-11-06)', () => {
  it('a note line is its exact text, where it came from and how bad', () => {
    expect(noteLine('There are no files on the clipboard.', { op: 'paste', title: "That didn't work", level: 'error' })).toEqual({
      text: 'There are no files on the clipboard.',
      op: 'paste',
      title: "That didn't work",
      level: 'error'
    })
    expect(noteLine('Saved 3 copies')).toEqual({ text: 'Saved 3 copies', level: 'info' })
  })

  it('a done note that says something failed is a warning, one that only reports is not', () => {
    expect(noteLevel('Saved 37 copies, 2 could not be read')).toBe('warn')
    expect(noteLevel('The copies could not be saved')).toBe('warn')
    expect(noteLevel("Couldn't extract story.zip")).toBe('warn')
    expect(noteLevel('Nothing could be pasted here.')).toBe('warn')
    expect(noteLevel('Saved 37 copies')).toBe('info')
  })

  it('goes to the log as a `note` line', () => {
    logNote('Nothing could be pasted here.', { op: 'paste', level: 'error' })
    expect(record).toHaveBeenCalledWith('note', { text: 'Nothing could be pasted here.', op: 'paste', level: 'error' })
  })

  it('a text too long for a line is cut, never dropped', () => {
    logNote('x'.repeat(5000))
    expect((record.mock.calls[0][1] as { text: string }).text.length).toBeLessThanOrEqual(1000)
  })
})
