import { describe, expect, it, vi } from 'vitest'
import { EmptyBinDialog } from './EmptyBinDialog'
import { emptyBars } from './deleteCopy'
import { labels, pick, specOf } from './testing'

const GB = 1024 ** 3
const go = { onCancel: () => {}, onEmpty: () => {} }

describe('EmptyBinDialog (Recycle Bin, D15; owner, 2026-11-10, #500 #503)', () => {
  it('says the count and the size, nothing else', () => {
    const s = specOf(
      EmptyBinDialog({
        usage: {
          items: 38,
          bytes: 1.4 * GB,
          drives: [{ path: 'C:\\', items: 38, bytes: 1.4 * GB, total: 400 * GB, free: 212 * GB }]
        },
        ...go
      })
    )
    expect(s.title).toBe('Empty the Recycle Bin?')
    expect(s.text).toBe('38 items · 1.4 GB')
  })

  it('says 1 item for one', () => {
    const s = specOf(EmptyBinDialog({ usage: { items: 1, bytes: 1024, drives: [] }, ...go }))
    expect(s.text).toBe('1 item · 1.0 KB')
  })

  it('shows an ellipsis until main answers, and the buttons are there at once', () => {
    const s = specOf(EmptyBinDialog({ ...go }))
    expect(s.text).toBe('…')
    expect(labels(s)).toEqual(['Cancel', 'Empty Recycle Bin'])
  })

  it('Cancel has the focus and Empty Recycle Bin is the red one', () => {
    const onEmpty = vi.fn()
    const s = specOf(EmptyBinDialog({ onCancel: () => {}, onEmpty }))
    expect(pick(s, 'Cancel')).toMatchObject({ tone: 'plain', focus: true })
    expect(pick(s, 'Empty Recycle Bin').tone).toBe('danger')
    expect(pick(s, 'Empty Recycle Bin').focus).toBeFalsy()
    pick(s, 'Empty Recycle Bin').onPick()
    expect(onEmpty).toHaveBeenCalledOnce()
  })

  it('uses the warning icon', () => {
    expect(EmptyBinDialog(go).props.icon).toBe('warn')
  })
})

describe('emptyBars: one bar per drive the bin spans', () => {
  it('splits a drive into what stays, what is freed and the free words', () => {
    const [bar] = emptyBars([
      { path: 'C:\\', items: 38, bytes: 40 * GB, total: 400 * GB, free: 100 * GB }
    ])
    expect(bar.drive).toBe('C:')
    expect(bar.stays).toBeCloseTo(0.65) // used 300 GB, 40 GB of it goes: 260 GB stays
    expect(bar.freed).toBeCloseTo(0.1)
    expect(bar.freeText).toBe('100 GB free')
    expect(bar.freedText).toBe('+40.0 GB')
  })

  it('never frees more than the drive uses', () => {
    const [bar] = emptyBars([{ path: 'D:\\', items: 1, bytes: 90 * GB, total: 100 * GB, free: 80 * GB }])
    expect(bar.stays! + bar.freed!).toBeLessThanOrEqual(0.2 + 1e-9)
    expect(bar.freed).toBeCloseTo(0.2)
  })

  it('a drive that did not answer its size has no bar fractions', () => {
    const [bar] = emptyBars([{ path: 'E:\\', items: 2, bytes: 5 * GB }])
    expect(bar.drive).toBe('E:')
    expect(bar.stays).toBeUndefined()
    expect(bar.freedText).toBe('+5.0 GB')
  })

  it('keeps the drives in order', () => {
    expect(
      emptyBars([
        { path: 'C:\\', items: 1, bytes: 1, total: 10, free: 5 },
        { path: 'D:\\', items: 1, bytes: 1, total: 10, free: 5 }
      ]).map((b) => b.drive)
    ).toEqual(['C:', 'D:'])
  })
})
