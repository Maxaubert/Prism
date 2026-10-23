import { beforeEach, describe, expect, it, vi } from 'vitest'
import { boolPref, enumPref } from './prefStore'

// The suite's setup provides localStorage; a blocked one is a spy that throws.
const mem = {
  get: (k: string) => localStorage.getItem(k),
  set: (k: string, v: string) => localStorage.setItem(k, v)
}
beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('enumPref', () => {
  const p = enumPref('t.enum', ['a', 'b'] as const, 'a')
  it('reads the default when unset or unknown, and writes the key byte for byte', () => {
    expect(p.get()).toBe('a')
    mem.set('t.enum', 'zzz')
    expect(p.get()).toBe('a')
    p.set('b')
    expect(mem.get('t.enum')).toBe('b')
    expect(p.get()).toBe('b')
  })
  it('tells its listeners, and lets go of them', () => {
    const heard = vi.fn()
    const off = p.onChange(heard)
    p.set('a')
    off()
    p.set('b')
    expect(heard).toHaveBeenCalledTimes(1)
  })
})

describe('boolPref', () => {
  it("on by default is on unless '0'; off by default is off unless '1'", () => {
    const on = boolPref('t.on', true)
    const off = boolPref('t.off', false)
    expect(on.get()).toBe(true)
    expect(off.get()).toBe(false)
    on.set(false)
    off.set(true)
    expect(mem.get('t.on')).toBe('0')
    expect(mem.get('t.off')).toBe('1')
  })
  it('a blocked store loses the choice, not the app', () => {
    const on = boolPref('t.on', true)
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(on.get()).toBe(true)
    expect(() => on.set(false)).not.toThrow()
  })
})
