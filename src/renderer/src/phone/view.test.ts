import { describe, expect, it } from 'vitest'
import { parseView, readView, writeView, VIEW_KEY } from './view'

describe('the phone view', () => {
  it('is a list unless grid was chosen, and survives a bad value', () => {
    expect(parseView(null)).toBe('list')
    expect(parseView('grid')).toBe('grid')
    expect(parseView('nonsense')).toBe('list')
  })
  it('round-trips through storage', () => {
    const m = new Map<string, string>()
    const store = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v)
    }
    expect(readView(store)).toBe('list')
    writeView('grid', store)
    expect(m.get(VIEW_KEY)).toBe('grid')
    expect(readView(store)).toBe('grid')
  })
})
