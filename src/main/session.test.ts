import { describe, expect, it } from 'vitest'
import { createSessionModel, savedEntry, validBounds } from './session'
import { parseTabs } from './tabs'

const strip = (...roots: string[]) => ({
  tabs: roots.map((root, i) => ({ id: `${root}-${i}`, role: 'explorer' as const, root })),
  active: 0
})
const B = { x: 10, y: 20, width: 900, height: 700 }

describe('the session file, one entry per window (2026-10-29)', () => {
  it('one window writes what it always wrote, at the top level', () => {
    const m = createSessionModel()
    m.report(1, strip('C:\\a'))
    m.bounds(1, B)
    const doc = m.doc()!
    expect(doc.tabs.map((t) => t.root)).toEqual(['C:\\a'])
    expect(doc.bounds).toEqual(B)
    expect(doc.windows).toHaveLength(1)
  })

  it('two windows each keep their own strip; neither overwrites the other', () => {
    const m = createSessionModel()
    m.report(1, strip('C:\\a'))
    m.report(2, strip('D:\\b'))
    m.report(1, strip('C:\\a', 'C:\\c'))
    expect(m.doc()!.windows.map((w) => w.tabs.map((t) => t.root))).toEqual([
      ['C:\\a', 'C:\\c'],
      ['D:\\b']
    ])
  })

  it('THE LAST WINDOW CLOSED is what a cold start opens (owner, 2026-10-29)', () => {
    const m = createSessionModel()
    m.report(1, strip('C:\\a'))
    m.report(2, strip('D:\\b'))
    m.focus(2)
    // Window two closes first: its entry goes, window one is what is left.
    m.closed(2, { others: true, quitting: false })
    expect(m.doc()!.tabs.map((t) => t.root)).toEqual(['C:\\a'])
    // Then window one, the last: it keeps its entry.
    m.closed(1, { others: false, quitting: false })
    expect(m.doc()!.tabs.map((t) => t.root)).toEqual(['C:\\a'])
    expect(m.doc()!.windows).toHaveLength(1)
  })

  it('closing the FIRST window first leaves the second as the one that comes back', () => {
    const m = createSessionModel()
    m.report(1, strip('C:\\a'))
    m.report(2, strip('D:\\b'))
    m.closed(1, { others: true, quitting: false })
    m.closed(2, { others: false, quitting: false })
    expect(m.doc()!.tabs.map((t) => t.root)).toEqual(['D:\\b'])
  })

  it('a quit with several open keeps them all, and the one focused last leads', () => {
    const m = createSessionModel()
    m.report(1, strip('C:\\a'))
    m.report(2, strip('D:\\b'))
    m.focus(1)
    m.focus(2)
    m.closed(1, { others: true, quitting: true })
    m.closed(2, { others: false, quitting: true })
    const doc = m.doc()!
    expect(doc.windows).toHaveLength(2)
    expect(doc.tabs.map((t) => t.root)).toEqual(['D:\\b'])
  })

  it('a window that never reported is not what comes back', () => {
    const m = createSessionModel()
    m.report(1, strip('C:\\a'))
    m.focus(2)
    m.bounds(2, B)
    expect(m.doc()!.tabs.map((t) => t.root)).toEqual(['C:\\a'])
    expect(m.doc()!.windows).toHaveLength(1)
  })

  it('the first window starts from the saved entry, so a move before its report keeps the strip', () => {
    const m = createSessionModel()
    m.seed(1, { tabs: strip('C:\\saved').tabs, active: 0, bounds: B })
    m.bounds(1, { ...B, x: 50 })
    const doc = m.doc()!
    expect(doc.tabs.map((t) => t.root)).toEqual(['C:\\saved'])
    expect(doc.bounds?.x).toBe(50)
  })

  it('a crash rebuild takes the old entry over', () => {
    const m = createSessionModel()
    m.report(1, strip('C:\\a'))
    m.rekey(1, 9)
    m.closed(1, { others: true, quitting: false }) // the old window's close: nothing of its own left
    expect(m.doc()!.tabs.map((t) => t.root)).toEqual(['C:\\a'])
  })

  it('no tab id is saved in two windows', () => {
    const m = createSessionModel()
    m.report(1, { tabs: [{ id: 'same', root: 'C:\\a' }], active: 0 })
    m.report(2, { tabs: [{ id: 'same', root: 'D:\\b' }], active: 0 })
    const [a, b] = m.doc()!.windows
    expect(a.tabs[0].id).toBe('same')
    expect(b.tabs[0].id).toBeUndefined()
  })

  it('the old reader still reads the new file: the top level is the strip', () => {
    const m = createSessionModel()
    m.report(1, strip('C:\\'))
    m.report(2, strip('C:\\Windows'))
    m.focus(2)
    const parsed = parseTabs(JSON.stringify(m.doc()))
    expect(parsed.tabs.map((t) => t.root)).toEqual(['C:\\Windows'])
  })

  it('reads a v1 file as one window, and its saved entry raw', () => {
    const v1 = JSON.stringify({ tabs: [{ id: 'x', root: 'C:\\a' }], active: 0 })
    expect(savedEntry(v1)).toEqual({ tabs: [{ id: 'x', root: 'C:\\a' }], active: 0 })
    expect(savedEntry('not json')).toBeNull()
    expect(savedEntry(null)).toBeNull()
    expect(
      savedEntry(JSON.stringify({ v: 2, tabs: [], active: 0, bounds: B, windows: [] }))?.bounds
    ).toEqual(B)
  })

  it('takes only whole bounds', () => {
    expect(validBounds({ x: 1, y: 2, width: 3, height: 4, maximised: true })).toEqual({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
      maximised: true
    })
    expect(validBounds({ x: 1, y: 2, width: 3 })).toBeNull()
    expect(validBounds(null)).toBeNull()
  })
})
