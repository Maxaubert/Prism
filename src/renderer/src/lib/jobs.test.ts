import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chipSummary,
  endJob,
  LAND_HOLD_MS,
  landingIn,
  landingReader,
  landJob,
  listJobs,
  MIN_SHOW_MS,
  NOTE_MS,
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
  it('a finished job keeps its rows until the listing can catch up, off the chip (2026-10-29)', () => {
    vi.useFakeTimers()
    try {
      const id = startJob('paste', 'Copying')
      landJob(id, 'C:/into', [{ path: 'C:/into/a.bin', name: 'a.bin', isFolder: false }])
      vi.advanceTimersByTime(MIN_SHOW_MS + 10)
      endJob(id)
      // Ended past its minimum: the rows stay, the chip has nothing to show.
      expect(landingIn(listJobs(), 'C:/into').map((r) => r.name)).toEqual(['a.bin'])
      expect(chipSummary(listJobs())).toBeNull()
      vi.advanceTimersByTime(LAND_HOLD_MS)
      expect(landingIn(listJobs(), 'C:/into')).toEqual([])
      expect(listJobs()).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('a quick finished job still shows on the chip for its minimum, rows held longer', () => {
    vi.useFakeTimers()
    try {
      const id = startJob('paste', 'Copying')
      landJob(id, 'C:/into', [{ path: 'C:/into/a.bin', name: 'a.bin', isFolder: false }])
      endJob(id)
      expect(chipSummary(listJobs())?.pct).toBe(100)
      vi.advanceTimersByTime(MIN_SHOW_MS)
      expect(chipSummary(listJobs())).toBeNull()
      expect(landingIn(listJobs(), 'C:/into')).toHaveLength(1)
      vi.advanceTimersByTime(LAND_HOLD_MS)
      expect(listJobs()).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a job with Cancel and a done note (#474)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetJobs()
  })
  afterEach(() => vi.useRealTimers())

  it('the chip offers the head job\'s Cancel while it runs', () => {
    const stop = vi.fn()
    const a = startJob('copies', 'Saving copies', stop)
    const s = chipSummary(listJobs())
    expect(s?.label).toBe('Saving copies')
    s?.cancel?.()
    expect(stop).toHaveBeenCalledTimes(1)
    // A paste has no Cancel.
    resetJobs()
    startJob('paste', 'Copying')
    expect(chipSummary(listJobs())?.cancel).toBeUndefined()
    void a
  })

  it('a job that ends with a note says it on the chip, without a bar or Cancel, then leaves', () => {
    const a = startJob('copies', 'Saving copies', vi.fn())
    vi.advanceTimersByTime(MIN_SHOW_MS + 1)
    endJob(a, 'Saved 37 copies, 2 could not be read')
    const s = chipSummary(listJobs())
    expect(s).toEqual({ label: 'Saved 37 copies, 2 could not be read', pct: 100, more: 0, note: true })
    expect(s?.cancel).toBeUndefined()
    vi.advanceTimersByTime(NOTE_MS - 1)
    expect(listJobs()).toHaveLength(1)
    vi.advanceTimersByTime(2)
    expect(listJobs()).toHaveLength(0)
  })

  it('a note shows over a job still working, so a failure is never lost behind a paste (review, 2026-11-01)', () => {
    const paste = startJob('paste', 'Copying')
    updateJob(paste, 40)
    const a = startJob('copies', 'Saving copies', vi.fn())
    endJob(a, 'Saved 37 copies, 2 could not be read')
    expect(chipSummary(listJobs())).toEqual({ label: 'Saved 37 copies, 2 could not be read', pct: 100, more: 1, note: true })
    vi.advanceTimersByTime(NOTE_MS + 1)
    expect(chipSummary(listJobs())).toEqual({ label: 'Copying', pct: 40, more: 0 })
  })

  it('a second note waits for the first: each is on the chip for its own NOTE_MS', () => {
    const a = startJob('copies', 'Saving copies', vi.fn())
    const b = startJob('copies', 'Saving copies', vi.fn())
    endJob(a, 'Saved 3 copies')
    vi.advanceTimersByTime(1000)
    endJob(b, 'Saved 4 copies, 1 could not be read')
    expect(chipSummary(listJobs())?.label).toBe('Saved 3 copies')
    vi.advanceTimersByTime(NOTE_MS - 1000 + 1)
    expect(chipSummary(listJobs())?.label).toBe('Saved 4 copies, 1 could not be read')
    vi.advanceTimersByTime(NOTE_MS - 2)
    expect(chipSummary(listJobs())?.label).toBe('Saved 4 copies, 1 could not be read')
    vi.advanceTimersByTime(2)
    expect(listJobs()).toHaveLength(0)
  })

  it('a job that can be cancelled leads the chip, so its Cancel is never behind an older paste', () => {
    const paste = startJob('paste', 'Copying')
    updateJob(paste, 10)
    const stop = vi.fn()
    startJob('copies', 'Saving copies', stop)
    const s = chipSummary(listJobs())
    expect(s?.label).toBe('Saving copies')
    expect(s?.more).toBe(1)
    s?.cancel?.()
    expect(stop).toHaveBeenCalledTimes(1)
  })
})
