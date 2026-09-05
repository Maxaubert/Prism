import { describe, expect, it } from 'vitest'
import { planLanding, type EntryKind } from './landing'

const known =
  (map: Record<string, EntryKind>) =>
  (p: string): EntryKind | undefined =>
    map[p]

describe('planLanding (what an action just created, Explorer\'s way)', () => {
  it('one file: marked, under the cursor, and shown', () => {
    const plan = planLanding(['C:\\d\\copy (2).txt'], known({ 'C:\\d\\copy (2).txt': 'file' }))
    expect(plan).toEqual({
      select: ['C:\\d\\copy (2).txt'],
      cursor: 'C:\\d\\copy (2).txt',
      open: 'C:\\d\\copy (2).txt',
      settled: true
    })
  })

  it('one folder: marked and under the cursor, nothing opens', () => {
    const plan = planLanding(['C:\\d\\Need for Speed'], known({ 'C:\\d\\Need for Speed': 'folder' }))
    expect(plan.open).toBeNull()
    expect(plan.cursor).toBe('C:\\d\\Need for Speed')
    expect(plan.settled).toBe(true)
  })

  it('several: all marked, the first under the cursor, nothing opens even if they are files', () => {
    const plan = planLanding(['C:\\d\\a.jpg', 'C:\\d\\b.jpg'], known({ 'C:\\d\\a.jpg': 'file', 'C:\\d\\b.jpg': 'file' }))
    expect(plan.select).toEqual(['C:\\d\\a.jpg', 'C:\\d\\b.jpg'])
    expect(plan.cursor).toBe('C:\\d\\a.jpg')
    expect(plan.open).toBeNull()
  })

  it('is not settled until the tree has listed every path, and never opens before then', () => {
    const plan = planLanding(['C:\\d\\x.txt'], known({}))
    expect(plan.settled).toBe(false)
    expect(plan.open).toBeNull()
    expect(plan.select).toEqual(['C:\\d\\x.txt']) // marked by path meanwhile
  })

  it('nothing landed is a settled no-op', () => {
    expect(planLanding([], known({}))).toEqual({ select: [], cursor: null, open: null, settled: true })
  })
})
