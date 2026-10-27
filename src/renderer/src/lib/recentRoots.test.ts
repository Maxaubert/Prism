import { beforeEach, describe, expect, it } from 'vitest'
import { forgetRoot, recentLabels, recentRoots, rememberRoot, withRoot } from './recentRoots'

beforeEach(() => localStorage.clear())

describe('withRoot', () => {
  it('puts the newest at the front', () => {
    expect(withRoot(['C:\\b'], 'C:\\a')).toEqual(['C:\\a', 'C:\\b'])
  })

  it('never lists a folder twice: seeing it again just moves it up', () => {
    expect(withRoot(['C:\\a', 'C:\\b', 'C:\\c'], 'C:\\c')).toEqual(['C:\\c', 'C:\\a', 'C:\\b'])
    // Windows paths differ in capitalisation and are still the same folder.
    expect(withRoot(['C:\\Photos'], 'c:\\photos')).toEqual(['c:\\photos'])
  })

  it('keeps a bounded history and ignores nothing-paths', () => {
    let list: string[] = []
    for (let i = 0; i < 20; i += 1) list = withRoot(list, `C:\\f${i}`)
    expect(list).toHaveLength(12)
    expect(list[0]).toBe('C:\\f19')
    expect(withRoot(list, '   ')).toEqual(list)
  })
})

describe('recentLabels', () => {
  it('uses the folder name alone when it is unambiguous', () => {
    expect(recentLabels(['C:\\work\\prism', 'C:\\pics'])).toEqual([
      { path: 'C:\\work\\prism', label: 'prism' },
      { path: 'C:\\pics', label: 'pics' }
    ])
  })

  it('carries the parent when two folders share a name', () => {
    const out = recentLabels(['C:\\site\\src', 'C:\\app\\src'])
    expect(out.map((o) => o.label)).toEqual(['src  ·  site', 'src  ·  app'])
  })

  it('survives a trailing separator and a drive root', () => {
    expect(recentLabels(['C:\\shots\\'])[0].label).toBe('shots')
    expect(recentLabels(['D:\\'])[0].label).toBe('D:')
  })
})

describe('the stored list', () => {
  it('round-trips, and forgetting removes exactly one folder', () => {
    rememberRoot('C:\\a')
    rememberRoot('C:\\b')
    expect(recentRoots()).toEqual(['C:\\b', 'C:\\a'])
    forgetRoot('c:\\a')
    expect(recentRoots()).toEqual(['C:\\b'])
  })

  it('treats nonsense in storage as no history', () => {
    localStorage.setItem('prism.recentRoots', '{"not":"an array"}')
    expect(recentRoots()).toEqual([])
    localStorage.setItem('prism.recentRoots', 'soup')
    expect(recentRoots()).toEqual([])
  })
})
