/**
 * FILE EXPLORER'S "GROUP BY DATE MODIFIED" (#285; owner, 2026-10-04: "do it
 * like file explorer, it uses today, last month, last year and probably
 * something before that too not sure"). Pure: `now` and the first day of the
 * week are handed in.
 *
 * The rule is CALENDAR buckets, checked in order, the first that holds wins.
 * The week starts on the user's first day of week (Windows' own setting,
 * HKCU\Control Panel\International\iFirstDayOfWeek; Monday on this machine).
 * MEASURED on Windows 11 26200 (2026-10-04, a Sunday, 20:49): a scratch folder
 * grouped by Date modified in File Explorer, its group headers read back over
 * UI Automation, put 4 Oct in Today, 3 Oct 23:59:59 in Yesterday, 28-29 Sep in
 * Earlier this week, 21 and 27 Sep in Last week, 1 and 20 Sep in Last month,
 * 2 Jan to 31 Aug in Earlier this year, 31 Dec 2025 and older in A long time
 * ago, and the future in Tomorrow, Next week, Later this month and Later this
 * year. The names are propsys.dll.mui's own strings. The owner's screenshot of
 * Downloads (same evening) agrees: 04/10 Today, 21-22/09 Last week (the
 * calendar week before this one), 10-20/09 Last month.
 */

export type DateGroup =
  | 'future'
  | 'later-this-year'
  | 'later-this-month'
  | 'next-week'
  | 'later-this-week'
  | 'tomorrow'
  | 'today'
  | 'yesterday'
  | 'earlier-this-week'
  | 'last-week'
  | 'earlier-this-month'
  | 'last-month'
  | 'earlier-this-year'
  | 'long-ago'

export const DATE_GROUP_LABEL: Record<DateGroup, string> = {
  future: 'Sometime in the future',
  'later-this-year': 'Later this year',
  'later-this-month': 'Later this month',
  'next-week': 'Next week',
  'later-this-week': 'Later this week',
  tomorrow: 'Tomorrow',
  today: 'Today',
  yesterday: 'Yesterday',
  'earlier-this-week': 'Earlier this week',
  'last-week': 'Last week',
  'earlier-this-month': 'Earlier this month',
  'last-month': 'Last month',
  'earlier-this-year': 'Earlier this year',
  'long-ago': 'A long time ago'
}

/** Newest first. */
export const DATE_GROUP_ORDER = Object.keys(DATE_GROUP_LABEL) as DateGroup[]

const day = (d: Date, offset = 0): number =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset).getTime()

/**
 * Which group a modified time falls in. `weekStart` is JavaScript's day
 * number (0 Sunday, 1 Monday ... 6 Saturday). Local time, as Explorer's.
 */
export function dateGroup(ms: number, now: Date, weekStart = 1): DateGroup {
  const today = day(now)
  const back = (now.getDay() - weekStart + 7) % 7
  const week = day(now, -back)
  const nextWeek = day(now, 7 - back)
  const month = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime()
  const year = new Date(now.getFullYear(), 0, 1).getTime()
  const nextYear = new Date(now.getFullYear() + 1, 0, 1).getTime()
  const tomorrow = day(now, 1)
  if (ms >= tomorrow) {
    if (ms < day(now, 2)) return 'tomorrow'
    if (ms < nextWeek) return 'later-this-week'
    if (ms < day(now, 14 - back)) return 'next-week'
    if (ms < nextMonth) return 'later-this-month'
    if (ms < nextYear) return 'later-this-year'
    return 'future'
  }
  if (ms >= today) return 'today'
  if (ms >= day(now, -1)) return 'yesterday'
  if (ms >= week) return 'earlier-this-week'
  if (ms >= day(now, -back - 7)) return 'last-week'
  if (ms >= month) return 'earlier-this-month'
  if (ms >= new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime()) return 'last-month'
  if (ms >= year) return 'earlier-this-year'
  return 'long-ago'
}

export interface DateDivider {
  /** The divider goes before the item at this index. */
  before: number
  group: DateGroup
  label: string
}

/**
 * The dividers for a list already in date order (either direction): one each
 * time the group changes, so only groups that have items appear, in the
 * list's own order. An item with no known time yet (its details are still on
 * their way, #271) opens no group of its own: it stays under the one above.
 */
export function dateDividers<T>(
  items: readonly T[],
  when: (item: T) => number | undefined,
  now: Date,
  weekStart = 1
): DateDivider[] {
  const out: DateDivider[] = []
  let last: DateGroup | null = null
  items.forEach((item, index) => {
    const ms = when(item)
    if (ms === undefined || !Number.isFinite(ms)) return
    const group = dateGroup(ms, now, weekStart)
    if (group === last) return
    last = group
    out.push({ before: index, group, label: DATE_GROUP_LABEL[group] })
  })
  return out
}

/**
 * The list with its dividers in it (#285). The rows stay ONE height, a
 * divider's included, so the virtual list's arithmetic (row N is at N times
 * the height) holds unchanged; only the index of a row moves. `entryAt` is
 * null on a divider, which the list already skips for the arrows, the sweep
 * and a pending focus, as it skips a search row that is unavailable.
 */
export interface DividedRows {
  /** Rows on screen: entries plus dividers. */
  length: number
  /** The divider at a row, if that row is one. */
  divider: (row: number) => DateDivider | undefined
  /** The entry's index at a row, or null on a divider. */
  entryAt: (row: number) => number | null
  /** The row an entry is drawn on. */
  rowOf: (entry: number) => number
}

export function divideRows(count: number, dividers: readonly DateDivider[]): DividedRows {
  const sorted = [...dividers]
    .filter((d) => d.before >= 0 && d.before < count)
    .sort((a, b) => a.before - b.before)
  const rowOf = new Int32Array(count)
  const entryAt = new Int32Array(count + sorted.length).fill(-1)
  const at = new Map<number, DateDivider>()
  let row = 0
  let next = 0
  for (let i = 0; i < count; i++) {
    while (next < sorted.length && sorted[next].before === i) at.set(row++, sorted[next++])
    rowOf[i] = row
    entryAt[row++] = i
  }
  return {
    length: row,
    divider: (r) => at.get(r),
    entryAt: (r) => (r >= 0 && r < row && entryAt[r] >= 0 ? entryAt[r] : null),
    rowOf: (i) => (i >= 0 && i < count ? rowOf[i] : -1)
  }
}
