import { beforeEach, describe, expect, it } from 'vitest'
import { chipSummary, endJob, listJobs, resetJobs, startJob, updateJob } from './jobs'

describe('the job queue behind the chip (2026-09-03)', () => {
  beforeEach(() => resetJobs())

  it('jobs queue in the order they started and leave when they end', () => {
    const a = startJob('extract', 'Extracting one.zip')
    const b = startJob('paste', 'Copying')
    expect(listJobs().map((j) => j.id)).toEqual([a, b])
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
    endJob(a)
    expect(chipSummary(listJobs())).toEqual({ label: 'Extracting story.cbz', pct: null, more: 1 })
  })
})
