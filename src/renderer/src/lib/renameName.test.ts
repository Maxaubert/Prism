import { describe, expect, it } from 'vitest'
import { renamedTo } from './renameName'

describe('renamedTo (#523)', () => {
  it('trims what was typed', () => {
    expect(renamedTo('a.txt', '  b.txt ')).toBe('b.txt')
  })
  it('is a cancel when empty, blank or unchanged', () => {
    expect(renamedTo('a.txt', '')).toBeNull()
    expect(renamedTo('a.txt', '   ')).toBeNull()
    expect(renamedTo('a.txt', 'a.txt')).toBeNull()
    expect(renamedTo('a.txt', ' a.txt ')).toBeNull()
  })
})
