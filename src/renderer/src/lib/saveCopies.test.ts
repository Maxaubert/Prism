import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aliasWindow, clearHost, setHost } from '../testing/host'
import { chipSummary, listJobs, resetJobs } from './jobs'
import { clearLanded, landRequest } from './landMarks'
import { saveCopiesJob } from './saveCopies'

aliasWindow()

describe('the Save copies as job (#474)', () => {
  beforeEach(() => {
    resetJobs()
    clearLanded()
  })
  afterEach(clearHost)

  it('runs as one job with Cancel, marks what landed, and ends on the note', async () => {
    let finish: (v: unknown) => void = () => {}
    const saveImageCopies = vi.fn(() => new Promise((r) => (finish = r)))
    const cancelImageCopies = vi.fn(() => Promise.resolve(true))
    setHost({ saveImageCopies, cancelImageCopies })
    const run = saveCopiesJob(['C:\\p\\a.heic', 'C:\\p\\b.heic', 'C:\\p\\n.txt'], 'jpeg')
    const s = chipSummary(listJobs())
    expect(s?.label).toBe('Saving JPEG copies')
    const job = listJobs()[0].id
    expect(saveImageCopies).toHaveBeenCalledWith(['C:\\p\\a.heic', 'C:\\p\\b.heic', 'C:\\p\\n.txt'], 'jpeg', job)
    s?.cancel?.()
    expect(cancelImageCopies).toHaveBeenCalledWith(job)
    finish({ saved: ['C:\\p\\a.jpg'], failed: 0, skipped: 1, canceled: true })
    await run
    expect(landRequest()?.paths).toEqual(['C:\\p\\a.jpg'])
    expect(chipSummary(listJobs())?.label).toBe('Stopped, saved 1 copy, 1 skipped (not pictures)')
  })

  it('a call that threw still ends the job, and says so', async () => {
    setHost({ saveImageCopies: vi.fn(() => Promise.reject(new Error('gone'))), cancelImageCopies: vi.fn() })
    await saveCopiesJob(['C:\\p\\a.png'], 'avif')
    expect(chipSummary(listJobs())?.label).toBe('The copies could not be saved')
  })
})
