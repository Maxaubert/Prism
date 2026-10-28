import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chipSummary,
  endJob,
  landingIn,
  landingReader,
  landJob,
  listJobs,
  MIN_SHOW_MS,
  resetJobs,
  startJob,
  updateJob,
  updateLanding
} from './jobs'

describe('the job queue behind the chip (2026-09-03)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetJobs()
  })
  afterEach(() => vi.useRealTimers())

  it('jobs queue in the order they started and leave when they end', () => {
    const a = startJob('add', 'Adding to one.zip')
    const b = startJob('paste', 'Copying')
    expect(listJobs().map((j) => j.id)).toEqual([a, b])
    vi.advanceTimersByTime(MIN_SHOW_MS + 1)
    endJob(a)
    expect(listJobs().map((j) => j.id)).toEqual([b])
    endJob('nothing') // a stale id is not an error
    expect(listJobs()).toHaveLength(1)
  })

  it('progress lands on the right job and starts indeterminate', () => {
    const a = startJob('add', 'Adding to one.zip')
    const b = startJob('add', 'Adding to two.zip')
    expect(listJobs()[0].pct).toBeNull()
    updateJob(b, 40)
    expect(listJobs().find((j) => j.id === a)?.pct).toBeNull()
    expect(listJobs().find((j) => j.id === b)?.pct).toBe(40)
  })

  it('the chip shows the OLDEST job and counts the rest', () => {
    expect(chipSummary([])).toBeNull()
    const a = startJob('paste', 'Copying')
    updateJob(a, 12)
    startJob('add', 'Adding to story.cbz')
    startJob('add', 'Adding to bundle.zip')
    expect(chipSummary(listJobs())).toEqual({ label: 'Copying', pct: 12, more: 2 })
    vi.advanceTimersByTime(MIN_SHOW_MS + 1)
    endJob(a)
    expect(chipSummary(listJobs())).toEqual({ label: 'Adding to story.cbz', pct: null, more: 1 })
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

  it('a job lingering at 100% yields the chip to a live one', () => {
    const a = startJob('paste', 'Copying')
    vi.advanceTimersByTime(20)
    endJob(a) // held at 100 for the minimum
    const b = startJob('paste', 'Copying')
    expect(chipSummary(listJobs())).toEqual({ label: 'Copying', pct: null, more: 1 })
    updateJob(b, 7)
    expect(chipSummary(listJobs())?.pct).toBe(7)
    vi.advanceTimersByTime(MIN_SHOW_MS)
    expect(listJobs().map((j) => j.id)).toEqual([b])
  })

  it('a job that ran long enough leaves at once', () => {
    const a = startJob('add', 'Adding to big.7z')
    vi.advanceTimersByTime(MIN_SHOW_MS * 3)
    endJob(a)
    expect(listJobs()).toHaveLength(0)
  })
})

describe('landing items (owner, 2026-10-28: a paste shows its rows)', () => {
  beforeEach(() => resetJobs())
  it('lists what a paste is copying into a folder, a landed one at 100 until the list has it', () => {
    const id = startJob('paste', 'Copying')
    landJob(id, 'C:/into', [
      { path: 'C:/into/a.bin', name: 'a.bin', isFolder: false },
      { path: 'C:/into/b', name: 'b', isFolder: true }
    ])
    expect(landingIn(listJobs(), 'c:/INTO/').map((it) => it.name)).toEqual(['a.bin', 'b'])
    expect(landingIn(listJobs(), 'C:/elsewhere')).toEqual([])
    updateLanding(id, 0, 40)
    expect(landingIn(listJobs(), 'C:/into')[0].pct).toBe(40)
    updateLanding(id, 0, 100)
    // Kept, at 100: the list drops it once the listing has the real file
    // (review, 2026-10-28: it blinked out until the watcher's re-read).
    expect(landingIn(listJobs(), 'C:/into').map((it) => [it.name, it.pct])).toEqual([
      ['a.bin', 100],
      ['b', 0]
    ])
  })
  it('progress on an item says every item before it is through', () => {
    const id = startJob('paste', 'Copying')
    landJob(id, 'C:/into', [
      { path: 'C:/into/1', name: '1', isFolder: false },
      { path: 'C:/into/2', name: '2', isFolder: false },
      { path: 'C:/into/3', name: '3', isFolder: false }
    ])
    updateLanding(id, 2, 30)
    expect(landingIn(listJobs(), 'C:/into').map((it) => it.pct)).toEqual([100, 100, 30])
    const before = listJobs()
    updateLanding(id, 2, 30)
    expect(listJobs()).toBe(before)
  })
  it('a folder reader hands back the same rows while only another folder or nothing changed', () => {
    const id = startJob('paste', 'Copying')
    landJob(id, 'C:/into', [{ path: 'C:/into/a', name: 'a', isFolder: false }])
    const into = landingReader('C:/into')
    const other = landingReader('C:/other')
    const first = into()
    const none = other()
    expect(first).toHaveLength(1)
    const b = startJob('paste', 'Copying')
    landJob(b, 'C:/elsewhere', [{ path: 'C:/elsewhere/x', name: 'x', isFolder: false }])
    updateLanding(b, 0, 50)
    expect(into()).toBe(first)
    expect(other()).toBe(none)
    updateLanding(id, 0, 60)
    expect(into()).not.toBe(first)
    expect(into()[0].pct).toBe(60)
  })
  it('a finished job lands nothing more', () => {
    const id = startJob('paste', 'Copying')
    landJob(id, 'C:/into', [{ path: 'C:/into/a.bin', name: 'a.bin', isFolder: false }])
    endJob(id)
    expect(landingIn(listJobs(), 'C:/into')).toEqual([])
  })
})
