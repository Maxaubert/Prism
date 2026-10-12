import { describe, expect, it, vi } from 'vitest'
import { createStore } from './store'

describe('createStore', () => {
  it('holds a value and tells every listener when it is set', () => {
    const store = createStore(1)
    const a = vi.fn()
    const b = vi.fn()
    store.subscribe(a)
    const offB = store.subscribe(b)
    store.set(2)
    expect(store.get()).toBe(2)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
    offB()
    store.notify()
    expect(a).toHaveBeenCalledTimes(2)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('a listener that unsubscribes while being told does not skip the next one', () => {
    const store = createStore('a')
    const later = vi.fn()
    const off = store.subscribe(() => off())
    store.subscribe(later)
    store.set('b')
    expect(later).toHaveBeenCalledTimes(1)
  })
})
