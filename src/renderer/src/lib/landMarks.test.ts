import { afterEach, describe, expect, it } from 'vitest'
import { clearLanded, landRequest, markLanded, planLanding } from './landMarks'

// What an action just made or put back is marked in the Explorer's list
// (#101): one channel, the request, and the pure plan the list applies.

afterEach(() => clearLanded())

const rows =
  (...known: string[]) =>
  (p: string): boolean =>
    known.map((k) => k.toLowerCase()).includes(p.toLowerCase())

describe('markLanded', () => {
  it('asks for the paths in the first one\'s folder, newest request wins', () => {
    markLanded(['C:\\d\\a.txt', 'C:\\d\\b.txt', 'C:\\elsewhere\\c.txt'])
    const first = landRequest()
    expect(first?.dir).toBe('C:\\d')
    expect(first?.paths).toEqual(['C:\\d\\a.txt', 'C:\\d\\b.txt'])
    markLanded(['C:\\d\\Extracted'])
    expect(landRequest()?.paths).toEqual(['C:\\d\\Extracted'])
    expect(landRequest()!.seq).toBeGreaterThan(first!.seq)
  })

  it('nothing landed asks for nothing', () => {
    markLanded([])
    expect(landRequest()).toBeNull()
  })

  it('is taken back only by its own seq', () => {
    markLanded(['C:\\d\\a.txt'])
    const seq = landRequest()!.seq
    clearLanded(seq - 1)
    expect(landRequest()).not.toBeNull()
    clearLanded(seq)
    expect(landRequest()).toBeNull()
  })
})

describe('planLanding', () => {
  const req = { seq: 1, dir: 'C:\\d', paths: ['C:\\d\\a.txt', 'C:\\d\\b.txt'], at: 0 }

  it('waits while a landed path has no real row yet', () => {
    expect(planLanding(req, 'C:\\d', rows('C:\\d\\a.txt'), 1000)).toEqual({ apply: false, expired: false })
  })

  it('marks every landed row once all are listed, the first under the cursor', () => {
    expect(planLanding(req, 'c:\\D\\', rows('C:\\d\\a.txt', 'C:\\d\\b.txt'), 1000)).toEqual({
      apply: true,
      select: ['C:\\d\\a.txt', 'C:\\d\\b.txt'],
      primary: 'C:\\d\\a.txt'
    })
  })

  it('past the deadline marks what did arrive, or gives up', () => {
    expect(planLanding(req, 'C:\\d', rows('C:\\d\\b.txt'), 60000)).toEqual({
      apply: true,
      select: ['C:\\d\\b.txt'],
      primary: 'C:\\d\\b.txt'
    })
    expect(planLanding(req, 'C:\\d', rows(), 60000)).toEqual({ apply: false, expired: true })
  })

  it('is not this list\'s when it shows another folder', () => {
    expect(planLanding(req, 'C:\\other', rows('C:\\d\\a.txt', 'C:\\d\\b.txt'), 1000)).toEqual({
      apply: false,
      expired: false
    })
    expect(planLanding(req, 'C:\\other', rows(), 60000)).toEqual({ apply: false, expired: true })
  })
})
