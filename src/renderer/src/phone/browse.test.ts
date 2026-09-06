import { describe, expect, it } from 'vitest'
import { crumbs, parentOf, stepFile } from './browse'

const f = (name: string) => ({
  path: `C:\\r\\${name}`,
  name,
  ext: '.mp4',
  kind: 'video' as const,
  size: 0,
  mtimeMs: 0
})

describe('browse', () => {
  it('walks up to the root and no further', () => {
    expect(parentOf('C:\\r', 'C:\\r\\a\\b')).toBe('C:\\r\\a')
    expect(parentOf('C:\\r', 'C:\\r\\a')).toBe('C:\\r')
    expect(parentOf('C:\\r', 'C:\\r')).toBeNull()
    expect(parentOf('C:\\r\\', 'C:\\r\\a')).toBe('C:\\r\\')
  })
  it('never climbs above the root, whatever the case of the path', () => {
    expect(parentOf('c:\\R', 'C:\\r\\a')).toBe('c:\\R')
    expect(parentOf('C:\\r', 'C:\\r\\')).toBeNull()
  })
  it('crumbs from the root folder name down', () => {
    expect(crumbs('C:\\films\\r', 'C:\\films\\r\\a\\b')).toEqual([
      { name: 'r', path: 'C:\\films\\r' },
      { name: 'a', path: 'C:\\films\\r\\a' },
      { name: 'b', path: 'C:\\films\\r\\a\\b' }
    ])
    expect(crumbs('C:\\films\\r', 'C:\\films\\r')).toEqual([{ name: 'r', path: 'C:\\films\\r' }])
  })
  it('names a drive root by its letter', () => {
    expect(crumbs('D:\\', 'D:\\')).toEqual([{ name: 'D:', path: 'D:' }])
  })
  it('steps through the files and stops at the ends', () => {
    const files = [f('a'), f('b'), f('c')]
    expect(stepFile(files, 'C:\\r\\b', 1)?.name).toBe('c')
    expect(stepFile(files, 'C:\\r\\b', -1)?.name).toBe('a')
    expect(stepFile(files, 'C:\\r\\c', 1)).toBeNull()
    expect(stepFile(files, 'C:\\r\\a', -1)).toBeNull()
    expect(stepFile(files, 'C:\\r\\zz', 1)).toBeNull()
  })
})
