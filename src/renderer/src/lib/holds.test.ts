import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BUSY_AFTER_MS,
  SETTLE_MS,
  STOP_GRACE_MS,
  beginHold,
  busyLabel,
  busyPct,
  endHold,
  holdMatches,
  holdProgress,
  isHeld,
  noteShownFolder,
  releaseSettled,
  resetHolds,
  stopHold
} from './holds'

const dir = 'C:\\media\\photos'

describe('the loading bar hold (owner, 2026-11-09)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetHolds()
  })
  afterEach(() => {
    vi.useRealTimers()
    resetHolds()
  })

  it('shows nothing for a job under a second, however close it comes', () => {
    beginHold('a', { verb: 'Deleting', dirs: [dir] })
    vi.advanceTimersByTime(BUSY_AFTER_MS - 1)
    expect(isHeld(dir)).toBe(false)
    expect(endHold('a')).toBe(false)
    vi.advanceTimersByTime(5000)
    expect(isHeld(dir)).toBe(false)
  })

  it('holds a folder the job changes once it has run a second, and only that folder', () => {
    beginHold('a', { verb: 'Deleting', dirs: [dir], under: ['C:\\media\\photos\\old'] })
    vi.advanceTimersByTime(BUSY_AFTER_MS)
    expect(isHeld(dir)).toBe(true)
    expect(isHeld('C:\\MEDIA\\PHOTOS\\')).toBe(true) // the spelling does not matter
    expect(isHeld('C:\\media\\photos\\old\\deep')).toBe(true) // inside something it moves
    expect(isHeld('C:\\media\\photos2')).toBe(false)
    expect(isHeld('C:\\other')).toBe(false)
    expect(holdMatches({ dirs: new Set(['c:\\a']), under: [] }, 'C:\\a\\')).toBe(true)
  })

  it('lets go at once when no tab in front shows the folder', () => {
    noteShownFolder('C:\\somewhere\\else')
    beginHold('a', { verb: 'Moving', dirs: [dir] })
    vi.advanceTimersByTime(BUSY_AFTER_MS)
    expect(endHold('a')).toBe(true)
    expect(isHeld(dir)).toBe(false)
  })

  it('waits for the read of the finished folder, then lets go', () => {
    noteShownFolder(dir)
    beginHold('a', { verb: 'Deleting', dirs: [dir] })
    vi.advanceTimersByTime(BUSY_AFTER_MS)
    endHold('a')
    expect(isHeld(dir)).toBe(true)
    releaseSettled('C:\\other')
    expect(isHeld(dir)).toBe(true)
    releaseSettled(dir)
    expect(isHeld(dir)).toBe(false)
  })

  it('never stays held if that read never comes', () => {
    noteShownFolder(dir)
    beginHold('a', { verb: 'Deleting', dirs: [dir] })
    vi.advanceTimersByTime(BUSY_AFTER_MS)
    endHold('a')
    vi.advanceTimersByTime(SETTLE_MS)
    expect(isHeld(dir)).toBe(false)
  })

  it('Cancel asks the job to stop, and lifts by itself if it cannot', () => {
    const stop = vi.fn()
    beginHold('a', { verb: 'Copying', dirs: [dir], cancel: stop })
    vi.advanceTimersByTime(BUSY_AFTER_MS)
    stopHold('a')
    stopHold('a') // a second press is nothing new
    expect(stop).toHaveBeenCalledTimes(1)
    expect(isHeld(dir)).toBe(true)
    vi.advanceTimersByTime(STOP_GRACE_MS)
    expect(isHeld(dir)).toBe(false)
    // The job ends later, on its own time: nothing throws, nothing comes back.
    expect(endHold('a')).toBe(false)
    expect(isHeld(dir)).toBe(false)
  })

  it('says how far: a count, a name, and a percentage from either', () => {
    expect(busyLabel({ verb: 'Deleting', name: null, total: 500, done: 120, stopping: false })).toBe('Deleting 120 of 500')
    expect(busyLabel({ verb: 'Copying', name: 'film.mkv', total: 1, done: 0, stopping: false })).toBe('Copying film.mkv')
    expect(busyLabel({ verb: 'Copying', name: null, total: null, done: 0, stopping: true })).toBe('Stopping…')
    expect(busyPct({ pct: 47, total: 1, done: 0 })).toBe(47)
    expect(busyPct({ pct: null, total: 4, done: 1 })).toBe(25)
    expect(busyPct({ pct: null, total: null, done: 0 })).toBeNull()
  })

  it('takes progress before the bar shows without touching the store', () => {
    beginHold('a', { verb: 'Copying', dirs: [dir], total: null })
    holdProgress('a', { done: 3, total: 10, pct: 30, name: 'x.jpg' })
    vi.advanceTimersByTime(BUSY_AFTER_MS)
    expect(isHeld(dir)).toBe(true)
  })
})
