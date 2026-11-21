import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const record = vi.fn()
vi.mock('prism-term-core/renderer/lib/diag', () => ({ record }))

const { say, toastStore, noticeStore, resetSay } = await import('./say')
const { NOTE_MS, TOAST_MS, TOAST_LONG_MS, SAY_TITLE } = await import('./sayCore')
const { listJobs, resetJobs, chipSummary } = await import('./jobs')

beforeEach(() => {
  vi.useFakeTimers()
  record.mockReset()
  resetSay()
  resetJobs()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('say() (#517, owner 2026-11-19)', () => {
  it('always writes the diagnostics log, whatever the kind', () => {
    say('Image copied', { op: 'copy-image' })
    say('Saved 3 copies', { op: 'paste', kind: 'chip' })
    say('Could not rename it.', { op: 'rename', kind: 'dialog' })
    expect(record).toHaveBeenCalledTimes(3)
    expect(record).toHaveBeenNthCalledWith(1, 'note', { text: 'Image copied', op: 'copy-image', level: 'info' })
    expect(record.mock.calls[1][1]).toMatchObject({ text: 'Saved 3 copies', op: 'paste', level: 'info' })
    expect(record.mock.calls[2][1]).toMatchObject({ text: 'Could not rename it.', op: 'rename', level: 'error', title: SAY_TITLE })
  })

  it('a toast is the one shared toast, shown for TOAST_MS', () => {
    say('Image copied', { level: 'info' })
    expect(toastStore.get()?.text).toBe('Image copied')
    vi.advanceTimersByTime(TOAST_MS - 1)
    expect(toastStore.get()).not.toBeNull()
    vi.advanceTimersByTime(2)
    expect(toastStore.get()).toBeNull()
  })

  it('a toast that says something failed stays TOAST_LONG_MS', () => {
    say('Could not save the copy', { level: 'warn' })
    vi.advanceTimersByTime(TOAST_MS + 1)
    expect(toastStore.get()?.text).toBe('Could not save the copy')
    vi.advanceTimersByTime(TOAST_LONG_MS - TOAST_MS)
    expect(toastStore.get()).toBeNull()
  })

  it('a newer toast replaces the old one and has its whole time', () => {
    say('one')
    vi.advanceTimersByTime(TOAST_MS - 100)
    say('two')
    vi.advanceTimersByTime(200)
    expect(toastStore.get()?.text).toBe('two')
    vi.advanceTimersByTime(TOAST_MS)
    expect(toastStore.get()).toBeNull()
  })

  it('a chip note is a line on the jobs chip for NOTE_MS', () => {
    say('Stopped. Copied 3 of 9.', { op: 'paste', kind: 'chip' })
    expect(chipSummary(listJobs())).toMatchObject({ label: 'Stopped. Copied 3 of 9.', note: true })
    vi.advanceTimersByTime(NOTE_MS + 1)
    expect(chipSummary(listJobs())).toBeNull()
  })

  it('a dialog notice is an error with the one title, shown until it is closed', () => {
    say('That could not be moved.', { op: 'move', kind: 'dialog' })
    expect(noticeStore.get()).toMatchObject({ text: 'That could not be moved.', op: 'move' })
    vi.advanceTimersByTime(60_000)
    expect(noticeStore.get()).not.toBeNull()
  })

  it('the toast and the chip take their times from one place', async () => {
    const jobs = await import('./jobs')
    expect(jobs.NOTE_MS).toBe(NOTE_MS)
    expect(TOAST_LONG_MS).toBeGreaterThan(TOAST_MS)
  })
})
describe('no surface keeps its own note, time or title any more (#517)', () => {
  const read = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8')
  it('the image viewer and App say through say()', () => {
    expect(read('../components/ImageView.tsx')).not.toMatch(/setCopyNote|data-copy-note|setTimeout\(\(\) => setCopy/)
    expect(read('../App.tsx')).not.toMatch(/setUndoNote|noteTimer/)
    // Undo's note moved with the Explorer split (audit #8): it still says through say().
    const explorer = read('../components/explorer/useExplorerController.ts')
    expect(explorer).not.toMatch(/setUndoNote|noteTimer/)
    expect(explorer).toContain("say(text, { op: 'undo' })")
  })
  it('the archive notice has the one title', () => {
    expect(read('../components/archive/useArchiveOps.tsx')).not.toContain('title="Archive"')
  })
})
