import { describe, expect, it } from 'vitest'
import { noteBinned, rowAfter, wasBinned } from './binnedRows'

describe('binnedRows', () => {
  const rows = ['a', 'b', 'c', 'd']
  const without = (...gone: string[]) => (p: string): boolean => !gone.includes(p)

  it('hands the selection to the row after the one that went', () => {
    expect(rowAfter(rows, 'b', without('b'))).toBe('c')
  })

  it('moves up when the last row went', () => {
    expect(rowAfter(rows, 'd', without('d'))).toBe('c')
  })

  it('steps over every row that went with it', () => {
    expect(rowAfter(rows, 'b', without('b', 'c'))).toBe('d')
    expect(rowAfter(rows, 'c', without('c', 'd'))).toBe('b')
  })

  it('is null with nothing left, or for a row it never had', () => {
    expect(rowAfter(['a'], 'a', without('a'))).toBeNull()
    expect(rowAfter(rows, 'z', without('z'))).toBeNull()
  })

  it('remembers only the last delete, whatever the case of the path', () => {
    noteBinned(['C:\\Dir\\A.txt'])
    expect(wasBinned('c:\\dir\\a.txt')).toBe(true)
    noteBinned(['C:\\Dir\\B.txt'])
    expect(wasBinned('C:\\Dir\\A.txt')).toBe(false)
  })
})
