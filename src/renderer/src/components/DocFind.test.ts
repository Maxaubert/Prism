import { describe, expect, it, vi } from 'vitest'

// A tiny hooks runtime: state and memos persist between calls of the component,
// and each effect's dependency list is recorded instead of run.
const slotsState: unknown[] = []
const memos: { deps: unknown[]; value: unknown }[] = []
const effectDeps: unknown[][] = []
let cursor = { s: 0, m: 0 }
vi.mock('react', async (orig) => {
  const real = await orig<typeof import('react')>()
  return {
    ...real,
    useState: (init: unknown): [unknown, () => void] => {
      const i = cursor.s++
      if (!(i in slotsState)) slotsState[i] = typeof init === 'function' ? (init as () => unknown)() : init
      return [slotsState[i], () => {}]
    },
    useMemo: (fn: () => unknown, deps: unknown[]): unknown => {
      const i = cursor.m++
      const old = memos[i]
      if (old && old.deps.every((d, k) => Object.is(d, deps[k]))) return old.value
      memos[i] = { deps, value: fn() }
      return memos[i].value
    },
    useEffect: (_fn: unknown, deps?: unknown[]): void => void (deps && effectDeps.push(deps))
  }
})
vi.mock('../lib/ownWindow', async (orig) => ({
  ...(await orig<typeof import('../lib/ownWindow')>()),
  useViewerWindows: () => []
}))

import { DocFind } from './DocFind'

describe('DocFind paint effect (audit #44)', () => {
  it('keeps the highlight names the same object between renders, so the effect does not re-run and scroll', () => {
    const props = { scroller: { current: null }, onClose: () => {} }
    const render = (): unknown[][] => {
      cursor = { s: 0, m: 0 }
      effectDeps.length = 0
      DocFind(props)
      return [...effectDeps]
    }
    const first = render()
    const second = render()
    const paint = (all: unknown[][]): unknown[] => all.find((d) => d.length === 5) as unknown[]
    expect(paint(first)).toBeDefined()
    paint(first).forEach((d, i) => expect(Object.is(d, paint(second)[i])).toBe(true))
  })
})