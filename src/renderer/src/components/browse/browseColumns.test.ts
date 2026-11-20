import { describe, expect, it } from 'vitest'
import { headerColumnsFor } from './browseColumns'

const keys = (view: Parameters<typeof headerColumnsFor>[0]): string[] =>
  headerColumnsFor(view).map((column) => column.key)

describe('headerColumnsFor', () => {
  it('a folder has Name, Type, Size and Date modified', () => {
    expect(keys({ searching: false, bin: false, archive: false })).toEqual([
      'name',
      'type',
      'size',
      'modified'
    ])
  })
  it('an archive adds Packed after Size', () => {
    expect(keys({ searching: false, bin: false, archive: true })).toEqual([
      'name',
      'type',
      'size',
      'packed',
      'modified'
    ])
  })
  it('the bin has its own columns', () => {
    expect(keys({ searching: false, bin: true, archive: false })).toEqual([
      'name',
      'from',
      'deleted',
      'size',
      'type'
    ])
  })
  it('a search wins over the place it runs in', () => {
    const search = ['name', 'path', 'size']
    expect(keys({ searching: true, bin: false, archive: false })).toEqual(search)
    expect(keys({ searching: true, bin: false, archive: true })).toEqual(search)
    expect(keys({ searching: true, bin: true, archive: false })).toEqual(search)
  })
  it('the bin wins over an archive', () => {
    expect(keys({ searching: false, bin: true, archive: true })).toEqual(
      keys({ searching: false, bin: true, archive: false })
    )
  })
})
