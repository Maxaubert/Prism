import { describe, expect, it } from 'vitest'
import type { BrowseShortcut } from '@shared/browse'
import { DOWNLOADS_SORT, dateView, downloadsPath, isDownloads, nextSort, viewSort } from './downloadsView'
import { navigateBrowseState, newBrowse, travelBrowseState, updateBrowseLocation, browseLocation } from './browse'

const DL = 'C:\\Users\\Admin\\Downloads'
const shortcuts: BrowseShortcut[] = [
  { name: 'Home', path: 'C:\\Users\\Admin', group: 'quick', known: 'home' },
  { name: 'Downloads', path: 'D:\\Moved\\Dl', group: 'quick', known: 'downloads' },
  { name: 'C:', path: 'C:\\', group: 'drive' }
]

describe('Downloads', () => {
  it('is the Known Folder, not a folder named Downloads', () => {
    const downloads = downloadsPath(shortcuts)
    expect(downloads).toBe('D:\\Moved\\Dl')
    expect(isDownloads(DL, downloads)).toBe(false)
    expect(isDownloads('d:/moved/dl/', downloads)).toBe(true)
    expect(isDownloads('D:\\Moved\\Dl\\Sub', downloads)).toBe(false)
    expect(downloadsPath([])).toBeNull()
    expect(isDownloads(DL, null)).toBe(false)
  })

  it('shows its own sort until one is picked there', () => {
    const name = { sort: { key: 'name', direction: 'asc' } as const }
    expect(viewSort(name, true)).toEqual(DOWNLOADS_SORT)
    expect(viewSort(name, false)).toEqual(name.sort)
    expect(viewSort({ ...name, sortChosen: true }, true)).toEqual(name.sort)
  })

  it('groups and mixes only by date, and never a search', () => {
    expect(dateView(true, DOWNLOADS_SORT, false)).toBe(true)
    expect(dateView(true, { key: 'modified', direction: 'asc' }, false)).toBe(true)
    expect(dateView(true, { key: 'name', direction: 'asc' }, false)).toBe(false)
    expect(dateView(true, DOWNLOADS_SORT, true)).toBe(false)
    expect(dateView(false, DOWNLOADS_SORT, false)).toBe(false)
  })

  it('starts Date modified newest first in Downloads only', () => {
    const byName = { key: 'name', direction: 'asc' } as const
    expect(nextSort(byName, 'modified', true)).toEqual({ key: 'modified', direction: 'desc' })
    expect(nextSort(byName, 'modified', false)).toEqual({ key: 'modified', direction: 'asc' })
    expect(nextSort(DOWNLOADS_SORT, 'modified', true)).toEqual({ key: 'modified', direction: 'asc' })
    expect(nextSort(DOWNLOADS_SORT, 'name', true)).toEqual(byName)
    expect(nextSort(byName, 'name', true)).toEqual({ key: 'name', direction: 'desc' })
  })

  it("remembers a pick in Downloads, and its own sort never travels", () => {
    // Documents sorted by size, then Downloads, then a subfolder of it.
    let b = newBrowse('C:\\Users\\Admin\\Documents')
    b = updateBrowseLocation(b, { sort: { key: 'size', direction: 'desc' }, sortChosen: true })
    b = navigateBrowseState(b, DL)
    expect(browseLocation(b).sortChosen).toBeUndefined()
    expect(viewSort(browseLocation(b), true)).toEqual(DOWNLOADS_SORT)
    b = navigateBrowseState(b, `${DL}\\Sub`)
    // The folder after Downloads takes what it would have taken anyway.
    expect(viewSort(browseLocation(b), false)).toEqual({ key: 'size', direction: 'desc' })
    // A pick in Downloads is kept for Back and for a revisit.
    b = travelBrowseState(b, -1)
    b = updateBrowseLocation(b, { sort: { key: 'name', direction: 'asc' }, sortChosen: true })
    b = navigateBrowseState(b, 'C:\\Elsewhere')
    expect(browseLocation(b).sortChosen).toBeUndefined()
    b = navigateBrowseState(b, DL)
    expect(viewSort(browseLocation(b), true)).toEqual({ key: 'name', direction: 'asc' })
  })
})
