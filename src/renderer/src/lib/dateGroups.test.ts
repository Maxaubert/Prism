import { describe, expect, it } from 'vitest'
import { DATE_GROUP_LABEL, DATE_GROUP_ORDER, dateDividers, dateGroup, divideRows } from './dateGroups'

describe('divideRows', () => {
  const d = (before: number, label: string): { before: number; group: 'today'; label: string } => ({
    before,
    group: 'today',
    label
  })
  it('puts each divider on its own row before its entry', () => {
    const rows = divideRows(4, [d(0, 'A'), d(2, 'B')])
    expect(rows.length).toBe(6)
    expect([0, 1, 2, 3, 4, 5].map((r) => rows.divider(r)?.label ?? rows.entryAt(r))).toEqual([
      'A', 0, 1, 'B', 2, 3
    ])
    expect([0, 1, 2, 3].map(rows.rowOf)).toEqual([1, 2, 4, 5])
  })
  it('is the plain list without dividers, and ignores ones out of range', () => {
    const rows = divideRows(3, [d(7, 'X')])
    expect(rows.length).toBe(3)
    expect(rows.entryAt(2)).toBe(2)
    expect(rows.entryAt(3)).toBeNull()
    expect(rows.rowOf(5)).toBe(-1)
    expect(divideRows(0, []).length).toBe(0)
  })
})

const at = (y: number, m: number, d: number, h = 12, min = 0, s = 0, ms = 0): number =>
  new Date(y, m - 1, d, h, min, s, ms).getTime()
const label = (ms: number, now: Date, weekStart = 1): string =>
  DATE_GROUP_LABEL[dateGroup(ms, now, weekStart)]

// The owner's screenshot of Downloads in File Explorer: Sunday 4 October
// 2026, 20:45, a Monday-first week (en-GB here).
const OWNER_NOW = new Date(2026, 9, 4, 20, 45)

describe('dateGroup', () => {
  it("reproduces the owner's File Explorer screenshot", () => {
    expect(label(at(2026, 10, 4, 20, 14), OWNER_NOW)).toBe('Today')
    expect(label(at(2026, 10, 4, 2, 53), OWNER_NOW)).toBe('Today')
    expect(label(at(2026, 9, 22, 14, 41), OWNER_NOW)).toBe('Last week')
    expect(label(at(2026, 9, 21, 20, 50), OWNER_NOW)).toBe('Last week')
    expect(label(at(2026, 9, 21, 9, 33), OWNER_NOW)).toBe('Last week')
    expect(label(at(2026, 9, 20, 19, 42), OWNER_NOW)).toBe('Last month')
    expect(label(at(2026, 9, 10, 22, 6), OWNER_NOW)).toBe('Last month')
  })

  it('matches what File Explorer put in each group on this machine', () => {
    // Measured 2026-10-04 20:49 over UI Automation (see dateGroups.ts).
    const now = new Date(2026, 9, 4, 20, 49)
    const cases: Array<[number, string]> = [
      [at(2026, 10, 4, 0, 0, 0), 'Today'],
      [at(2026, 10, 3, 23, 59, 59), 'Yesterday'],
      [at(2026, 9, 29), 'Earlier this week'],
      [at(2026, 9, 28, 0, 30), 'Earlier this week'],
      [at(2026, 9, 27, 23), 'Last week'],
      [at(2026, 9, 21, 9, 33), 'Last week'],
      [at(2026, 9, 20, 19, 42), 'Last month'],
      [at(2026, 9, 1, 8), 'Last month'],
      [at(2026, 8, 31), 'Earlier this year'],
      [at(2026, 1, 2), 'Earlier this year'],
      [at(2025, 12, 31, 23, 59, 59), 'A long time ago'],
      [at(2023, 5, 1), 'A long time ago'],
      [at(2026, 10, 5), 'Tomorrow'],
      [at(2026, 10, 8), 'Next week'],
      [at(2026, 10, 14), 'Later this month'],
      [at(2026, 12, 1), 'Later this year']
    ]
    for (const [ms, name] of cases) expect([new Date(ms).toString(), label(ms, now)]).toEqual([new Date(ms).toString(), name])
  })

  it('turns over at local midnight, to the millisecond', () => {
    const now = new Date(2026, 9, 7, 0, 0, 0, 1) // Wednesday, just past midnight
    expect(label(at(2026, 10, 7, 0, 0, 0, 0), now)).toBe('Today')
    expect(label(at(2026, 10, 6, 23, 59, 59, 999), now)).toBe('Yesterday')
    expect(label(at(2026, 10, 6, 0, 0, 0, 0), now)).toBe('Yesterday')
    expect(label(at(2026, 10, 5, 23, 59, 59, 999), now)).toBe('Earlier this week')
    expect(label(at(2026, 10, 5, 0, 0), now)).toBe('Earlier this week')
    expect(label(at(2026, 10, 4, 23, 59, 59, 999), now)).toBe('Last week')
    expect(label(at(2026, 9, 28, 0, 0), now)).toBe('Last week')
    expect(label(at(2026, 9, 27, 23, 59, 59, 999), now)).toBe('Last month') // September
  })

  it('on a Monday, yesterday is Yesterday though it is last week', () => {
    const now = new Date(2026, 9, 5, 9) // Monday
    expect(label(at(2026, 10, 4), now)).toBe('Yesterday')
    expect(label(at(2026, 10, 3), now)).toBe('Last week')
    expect(label(at(2026, 9, 28, 0, 0), now)).toBe('Last week')
    expect(label(at(2026, 9, 27, 23), now)).toBe('Last month')
  })

  it('has Earlier this month when the month began before last week', () => {
    const now = new Date(2026, 9, 22, 12) // Thursday 22 October
    expect(label(at(2026, 10, 19), now)).toBe('Earlier this week')
    expect(label(at(2026, 10, 12), now)).toBe('Last week')
    expect(label(at(2026, 10, 11, 23), now)).toBe('Earlier this month')
    expect(label(at(2026, 10, 1, 0, 0), now)).toBe('Earlier this month')
    expect(label(at(2026, 9, 30, 23, 59), now)).toBe('Last month')
  })

  it('calls December Last month in January, and last year before that A long time ago', () => {
    const now = new Date(2027, 0, 20, 12) // Wednesday 20 January 2027
    expect(label(at(2026, 12, 10), now)).toBe('Last month')
    expect(label(at(2026, 11, 30, 23), now)).toBe('A long time ago')
    // The first week of a year reaches back into December as Last week.
    const early = new Date(2027, 0, 6, 12) // Wednesday 6 January
    expect(label(at(2026, 12, 29), early)).toBe('Last week')
    expect(label(at(2026, 12, 20), early)).toBe('Last month')
  })

  it("follows the user's first day of the week", () => {
    // Sunday 4 October: with a Sunday-first week, today starts the week, so
    // 27 Sep (Sunday) opens last week and 21-22 Sep are the week before.
    expect(label(at(2026, 9, 27), OWNER_NOW, 0)).toBe('Last week')
    expect(label(at(2026, 9, 26), OWNER_NOW, 0)).toBe('Last month')
    expect(label(at(2026, 9, 22), OWNER_NOW, 0)).toBe('Last month')
    expect(label(at(2026, 10, 3), OWNER_NOW, 0)).toBe('Yesterday')
    expect(label(at(2026, 10, 2), OWNER_NOW, 0)).toBe('Last week')
  })

  it('puts a time past next year in Sometime in the future, and an unknown 0 long ago', () => {
    expect(label(at(2027, 2, 1), OWNER_NOW)).toBe('Sometime in the future')
    expect(label(0, OWNER_NOW)).toBe('A long time ago')
  })

  it('orders the groups newest first', () => {
    expect(DATE_GROUP_ORDER.indexOf('today')).toBeLessThan(DATE_GROUP_ORDER.indexOf('yesterday'))
    expect(DATE_GROUP_ORDER.at(-1)).toBe('long-ago')
    expect(DATE_GROUP_ORDER[0]).toBe('future')
  })
})

describe('dateDividers', () => {
  const items = [
    at(2026, 10, 4, 20, 14),
    at(2026, 10, 4, 2, 53),
    at(2026, 9, 22, 14, 41),
    at(2026, 9, 21, 9, 33),
    at(2026, 9, 20, 19, 42),
    at(2026, 9, 10, 22, 6)
  ]
  it('opens a divider where the group changes, only for groups with items', () => {
    expect(dateDividers(items, (t) => t, OWNER_NOW)).toEqual([
      { before: 0, group: 'today', label: 'Today' },
      { before: 2, group: 'last-week', label: 'Last week' },
      { before: 4, group: 'last-month', label: 'Last month' }
    ])
  })
  it('follows the list order, oldest first too', () => {
    expect(dateDividers([...items].reverse(), (t) => t, OWNER_NOW).map((d) => [d.before, d.label])).toEqual([
      [0, 'Last month'],
      [2, 'Last week'],
      [4, 'Today']
    ])
  })
  it('lets an item with no time yet stay under the group above', () => {
    const list = [items[0], undefined, items[2]]
    expect(dateDividers(list, (t) => t, OWNER_NOW).map((d) => d.before)).toEqual([0, 2])
    expect(dateDividers([undefined], (t) => t, OWNER_NOW)).toEqual([])
    expect(dateDividers([], (t: number) => t, OWNER_NOW)).toEqual([])
  })
})
