import { beforeEach, describe, expect, it } from 'vitest'
import { humanFor, noteWorking, resetClock, workingFor } from './agentClock'

beforeEach(() => resetClock())

describe('when the work started', () => {
  it('starts the clock the first time a session is seen working', () => {
    noteWorking(new Set(['a']), 1000)
    expect(workingFor('a', 4000)).toBe(3000)
  })

  it('does NOT restart it while the session keeps working', () => {
    // The whole point: outputRuns.start resets on a 1.5s silence, so an agent
    // that pauses to think would otherwise read as freshly started.
    noteWorking(new Set(['a']), 1000)
    noteWorking(new Set(['a']), 9000)
    noteWorking(new Set(['a']), 20000)
    expect(workingFor('a', 20000)).toBe(19000)
  })

  it('forgets a session that stops', () => {
    noteWorking(new Set(['a']), 1000)
    noteWorking(new Set(), 2000)
    expect(workingFor('a', 3000)).toBeNull()
  })

  it('restarts the clock when it starts again', () => {
    noteWorking(new Set(['a']), 1000)
    noteWorking(new Set(), 2000)
    noteWorking(new Set(['a']), 5000)
    expect(workingFor('a', 6000)).toBe(1000)
  })

  it('keeps sessions apart', () => {
    noteWorking(new Set(['a']), 1000)
    noteWorking(new Set(['a', 'b']), 4000)
    expect(workingFor('a', 5000)).toBe(4000)
    expect(workingFor('b', 5000)).toBe(1000)
  })

  it('answers null for a session that was never working', () => {
    expect(workingFor('nobody')).toBeNull()
  })

  it('never answers negative, whatever clock it is handed', () => {
    noteWorking(new Set(['a']), 5000)
    expect(workingFor('a', 1000)).toBe(0)
  })
})

describe('the duration in words', () => {
  it('does not count the first few seconds out loud', () => {
    expect(humanFor(0)).toBe('a few seconds')
    expect(humanFor(9_400)).toBe('a few seconds')
  })

  it('counts seconds, then minutes, then hours', () => {
    expect(humanFor(10_000)).toBe('10 seconds')
    expect(humanFor(59_900)).toBe('59 seconds')
    expect(humanFor(60_000)).toBe('1 minute')
    expect(humanFor(125_000)).toBe('2 minutes')
    expect(humanFor(3_600_000)).toBe('1 hour')
    expect(humanFor(3_900_000)).toBe('1 hour 5 minutes')
    expect(humanFor(7_200_000)).toBe('2 hours')
  })

  it('rounds down, so it never claims more time than has passed', () => {
    expect(humanFor(119_999)).toBe('1 minute')
  })
})
