import { describe, expect, it } from 'vitest'
import { binUsage } from './binUsage'
import type { BinRow } from './binList'

const row = (dir: string, size: number): BinRow =>
  ({ path: `${dir}\\$Rx`, dir, id: 'x', name: 'n', from: 'C:\\', deleted: 0, size, folder: false, kind: 'other' }) as BinRow

describe('binUsage: what Empty Recycle Bin would free, per drive', () => {
  it('sums the $I sizes by the drive each bin folder is on, and asks each drive for its space', async () => {
    const asked: string[][] = []
    const r = await binUsage(
      ['C:\\$Recycle.Bin\\S-1', 'D:\\$Recycle.Bin\\S-1'],
      async () => ({
        rows: [
          row('C:\\$Recycle.Bin\\S-1', 100),
          row('C:\\$Recycle.Bin\\S-1', 50),
          row('D:\\$Recycle.Bin\\S-1', 7)
        ],
        skipped: 0
      }),
      async (roots) => {
        asked.push(roots)
        return roots.map((path) => ({ path, total: 1000, free: 400 }))
      }
    )
    expect(r.items).toBe(3)
    expect(r.bytes).toBe(157)
    expect(r.drives).toEqual([
      { path: 'C:\\', items: 2, bytes: 150, total: 1000, free: 400 },
      { path: 'D:\\', items: 1, bytes: 7, total: 1000, free: 400 }
    ])
    expect(asked).toEqual([['C:\\', 'D:\\']])
  })

  it('leaves a drive with nothing in its bin out, and a drive that did not answer has no sizes', async () => {
    const r = await binUsage(
      ['C:\\$Recycle.Bin\\S-1', 'D:\\$Recycle.Bin\\S-1'],
      async () => ({ rows: [row('D:\\$Recycle.Bin\\S-1', 7)], skipped: 0 }),
      async (roots) => roots.map((path) => ({ path }))
    )
    expect(r.drives).toEqual([{ path: 'D:\\', items: 1, bytes: 7 }])
  })

  it('an empty bin has no drives and asks nothing', async () => {
    let asked = false
    const r = await binUsage(
      ['C:\\$Recycle.Bin\\S-1'],
      async () => ({ rows: [], skipped: 0 }),
      async () => {
        asked = true
        return []
      }
    )
    expect(r).toEqual({ items: 0, bytes: 0, drives: [] })
    expect(asked).toBe(false)
  })
})
