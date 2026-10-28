import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPref } from './createPref'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

const refuse = (): void => {
  vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
    throw new Error('SecurityError')
  })
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw new Error('QuotaExceededError')
  })
}

const sideOf = (raw: string | null): 'left' | 'right' => (raw === 'right' ? 'right' : 'left')

describe('createPref', () => {
  it('reads, writes and tells its listeners under its own key', () => {
    const pref = createPref({ key: 'prism.explorer.side', read: 'always', parse: sideOf, fallback: 'left' })
    expect(pref.get()).toBe('left')
    const heard = vi.fn()
    const off = pref.subscribe(heard)
    pref.set('right')
    expect(localStorage.getItem('prism.explorer.side')).toBe('right')
    expect(pref.get()).toBe('right')
    expect(heard).toHaveBeenCalledTimes(1)
    off()
    pref.set('left')
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('knows whether its key travels between windows', () => {
    expect(createPref({ key: 'prism.sort', parse: String, fallback: '' }).scope).toBe('shared')
    expect(createPref({ key: 'prism.settings.rail', parse: String, fallback: '' }).scope).toBe('window')
  })

  it('never throws when storage refuses: reads fall back, a write lasts the session', () => {
    localStorage.setItem('prism.explorer.side', 'right')
    refuse()
    const always = createPref({ key: 'prism.explorer.side', read: 'always', parse: sideOf, fallback: 'left' })
    expect(() => always.get()).not.toThrow()
    expect(always.get()).toBe('left')
    expect(() => always.set('right')).not.toThrow()

    const once = createPref({ key: 'prism.explorer.side', parse: sideOf, fallback: 'left' })
    expect(once.get()).toBe('left')
    const heard = vi.fn()
    once.subscribe(heard)
    expect(() => once.set('right')).not.toThrow()
    expect(once.get()).toBe('right')
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('reads junk through parse, and a parse that throws as the fallback', () => {
    localStorage.setItem('prism.sort', '{not json')
    const pref = createPref({
      key: 'prism.sort',
      parse: (raw) => JSON.parse(raw ?? '{}') as { dir?: string },
      serialize: (v) => JSON.stringify(v),
      fallback: { dir: 'asc' }
    })
    expect(pref.get()).toEqual({ dir: 'asc' })
  })

  it('once: holds the value it loaded until reload, as a fresh launch would', () => {
    localStorage.setItem('prism.explorer.side', 'right')
    const pref = createPref({ key: 'prism.explorer.side', parse: sideOf, fallback: 'left' })
    localStorage.setItem('prism.explorer.side', 'left')
    expect(pref.get()).toBe('right')
    pref.reload()
    expect(pref.get()).toBe('left')
  })

  it('always: keeps an object value the same object while the stored string is the same', () => {
    localStorage.setItem('prism.explorer.widths', '{"places":200}')
    const pref = createPref({
      key: 'prism.explorer.widths',
      read: 'always',
      parse: (raw) => JSON.parse(raw ?? '{}') as { places?: number },
      serialize: (v) => JSON.stringify(v),
      fallback: {}
    })
    const first = pref.get()
    expect(pref.get()).toBe(first)
    localStorage.setItem('prism.explorer.widths', '{"places":300}')
    expect(pref.get()).toEqual({ places: 300 })
    expect(pref.get()).not.toBe(first)
  })

  it('live: another window\'s storage event reaches its listeners', () => {
    const target = new EventTarget()
    vi.stubGlobal('window', target)
    const pref = createPref({ key: 'prism.open.external', read: 'always', live: true, parse: String, fallback: '' })
    const heard = vi.fn()
    const off = pref.subscribe(heard)
    target.dispatchEvent(new Event('storage'))
    expect(heard).toHaveBeenCalledTimes(1)
    off()
    target.dispatchEvent(new Event('storage'))
    expect(heard).toHaveBeenCalledTimes(1)
  })
})
