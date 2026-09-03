import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chipSummary, endJob, listJobs, MIN_SHOW_MS, resetJobs, startJob, updateJob } from './jobs'

describe('the job queue behind the chip (2026-09-03)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetJobs()
  })
  afterEach(() => vi.useRealTimers())

  it('jobs queue in the order they started and leave when they end', () => {
    const a = startJob('extract', 'Extracting one.zip')
    const b = startJob('paste', 'Copying')
    expect(listJobs().map((j) => j.id)).toEqual([a, b])
    vi.advanceTimersByTime(MIN_SHOW_MS + 1)
    endJob(a)
    expect(listJobs().map((j) => j.id)).toEqual([b])
    endJob('nothing') // a stale id is not an error
    expect(listJobs()).toHaveLength(1)
  })

  it('progress lands on the right job and starts indeterminate', () => {
    const a = startJob('extract', 'Extracting one.zip')
    const b = startJob('extract', 'Extracting two.zip')
    expect(listJobs()[0].pct).toBeNull()
    updateJob(b, 40)
    expect(listJobs().find((j) => j.id === a)?.pct).toBeNull()
    expect(listJobs().find((j) => j.id === b)?.pct).toBe(40)
  })

  it('the chip shows the OLDEST job and counts the rest', () => {
    expect(chipSummary([])).toBeNull()
    const a = startJob('paste', 'Copying')
    updateJob(a, 12)
    startJob('extract', 'Extracting story.cbz')
    startJob('add', 'Adding to bundle.zip')
    expect(chipSummary(listJobs())).toEqual({ label: 'Copying', pct: 12, more: 2 })
    vi.advanceTimersByTime(MIN_SHOW_MS + 1)
    endJob(a)
    expect(chipSummary(listJobs())).toEqual({ label: 'Extracting story.cbz', pct: null, more: 1 })
  })

  it('a job that finishes inside a frame still shows for the minimum, at 100%', () => {
    const a = startJob('paste', 'Copying')
    vi.advanceTimersByTime(30)
    endJob(a)
    // still there, held at done
    expect(listJobs()).toHaveLength(1)
    expect(listJobs()[0].pct).toBe(100)
    // late progress cannot pull it back down
    updateJob(a, 50)
    expect(listJobs()[0].pct).toBe(100)
    vi.advanceTimersByTime(MIN_SHOW_MS - 30 - 1)
    expect(listJobs()).toHaveLength(1)
    vi.advanceTimersByTime(2)
    expect(listJobs()).toHaveLength(0)
  })

  it('a job that ran long enough leaves at once', () => {
    const a = startJob('extract', 'Extracting big.7z')
    vi.advanceTimersByTime(MIN_SHOW_MS * 3)
    endJob(a)
    expect(listJobs()).toHaveLength(0)
  })
})
