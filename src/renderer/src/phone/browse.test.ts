import { describe, expect, it } from 'vitest'
import { answerFor, crumbs, fileFromHit, isLocalPath, parentOf, samePath, scrollCrumbsToEnd, stepFile } from './browse'

const f = (name: string) => ({
  path: `C:\\r\\${name}`,
  name,
  ext: '.mp4',
  kind: 'video' as const,
  size: 0,
  mtimeMs: 0
})

describe('browse', () => {
  it('walks up a folder at a time, a drive top to This PC, and no further', () => {
    expect(parentOf('C:\\r\\a\\b')).toBe('C:\\r\\a')
    expect(parentOf('C:\\r\\a\\')).toBe('C:\\r')
    expect(parentOf('C:\\r')).toBe('C:\\')
    expect(parentOf('C:\\')).toBe('')
    expect(parentOf('c:')).toBe('')
    expect(parentOf('')).toBeNull()
  })
  it('crumbs from This PC through the drive down', () => {
    expect(crumbs('C:\\films\\r')).toEqual([
      { name: 'This PC', path: '' },
      { name: 'C:', path: 'C:\\' },
      { name: 'films', path: 'C:\\films' },
      { name: 'r', path: 'C:\\films\\r' }
    ])
    expect(crumbs('D:\\')).toEqual([
      { name: 'This PC', path: '' },
      { name: 'D:', path: 'D:\\' }
    ])
    expect(crumbs('')).toEqual([{ name: 'This PC', path: '' }])
  })
  it('believes only a local drive path', () => {
    expect(isLocalPath('C:\\r')).toBe(true)
    expect(isLocalPath('d:/r')).toBe(true)
    expect(isLocalPath('\\\\nas\\r')).toBe(false)
    expect(isLocalPath('r\\a')).toBe(false)
    expect(isLocalPath('')).toBe(false)
  })
  it('calls two spellings of one folder the same folder', () => {
    expect(samePath('C:\\r', 'c:\\R\\')).toBe(true)
    expect(samePath('C:\\r', 'C:\\r\\a')).toBe(false)
  })
  it('steps through the files and stops at the ends', () => {
    const files = [f('a'), f('b'), f('c')]
    expect(stepFile(files, 'C:\\r\\b', 1)?.name).toBe('c')
    expect(stepFile(files, 'C:\\r\\b', -1)?.name).toBe('a')
    expect(stepFile(files, 'C:\\r\\c', 1)).toBeNull()
    expect(stepFile(files, 'C:\\r\\a', -1)).toBeNull()
    expect(stepFile(files, 'C:\\r\\zz', 1)).toBeNull()
  })
  it('turns a search hit into the file a row hands the viewer', () => {
    expect(fileFromHit({ path: 'C:\\r\\a\\Holiday.MP4', name: 'Holiday.MP4', kind: 'video', dir: 'a' })).toEqual({
      path: 'C:\\r\\a\\Holiday.MP4',
      name: 'Holiday.MP4',
      ext: '.mp4',
      kind: 'video',
      size: 0,
      mtimeMs: 0
    })
    expect(fileFromHit({ path: 'C:\\r\\Dockerfile', name: 'Dockerfile', kind: 'text', dir: '' }).ext).toBe('')
  })
})

describe('the crumb row and the search answer (audit #38, #48)', () => {
  it('scrolls the crumb row to its end, where the folder you are in is', () => {
    const nav = { scrollLeft: 0, scrollWidth: 900 }
    scrollCrumbsToEnd(nav)
    expect(nav.scrollLeft).toBe(900)
    expect(() => scrollCrumbsToEnd(null)).not.toThrow()
  })
  it('an answer counts only for the query AND the folder it was asked in', () => {
    const a = { q: 'x', dir: 'C:\\A', hits: [] }
    expect(answerFor(a, 'x', 'C:\\A')).toBe(a)
    expect(answerFor(a, 'x', 'c:\\a\\')).toBe(a)
    expect(answerFor(a, 'x', 'C:\\B')).toBeNull()
    expect(answerFor(a, 'y', 'C:\\A')).toBeNull()
    expect(answerFor(null, 'x', 'C:\\A')).toBeNull()
  })
})