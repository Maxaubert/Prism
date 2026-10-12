import { describe, expect, it } from 'vitest'
import { createLru } from './lru'

describe('createLru', () => {
  it('drops the oldest past max', () => {
    const c = createLru<string, number>(2)
    c.set('a', 1)
    c.set('b', 2)
    c.set('c', 3)
    expect(c.size).toBe(2)
    expect(c.peek('a')).toBeUndefined()
    expect(c.peek('c')).toBe(3)
  })

  it('a get is a use: the entry it read outlives an older one', () => {
    const c = createLru<string, number>(2)
    c.set('a', 1)
    c.set('b', 2)
    expect(c.get('a')).toBe(1)
    c.set('c', 3)
    expect(c.peek('a')).toBe(1)
    expect(c.peek('b')).toBeUndefined()
  })

  it('a peek is not a use', () => {
    const c = createLru<string, number>(2)
    c.set('a', 1)
    c.set('b', 2)
    c.peek('a')
    c.set('c', 3)
    expect(c.peek('a')).toBeUndefined()
  })

  it('a set on a known key makes it the newest', () => {
    const c = createLru<string, number>(2)
    c.set('a', 1)
    c.set('b', 2)
    c.set('a', 9)
    c.set('c', 3)
    expect(c.peek('a')).toBe(9)
    expect(c.peek('b')).toBeUndefined()
  })

  it('delete and clear', () => {
    const c = createLru<string, number>(3)
    c.set('a', 1)
    c.set('b', 2)
    expect(c.delete('a')).toBe(true)
    expect(c.get('a')).toBeUndefined()
    c.clear()
    expect(c.size).toBe(0)
  })
})
