import { describe, expect, it } from 'vitest'
import type { ViewerFile } from '@shared/types'
import { readOnlyFile } from './readOnlyFile'
import { thumbSource } from './thumbKind'
import { goesToWindows } from './unsupported'

const plain: ViewerFile = { path: 'C:\\a\\b.txt', name: 'b.txt', ext: '.txt', kind: 'text' }
const member: ViewerFile = { ...plain, member: true }
const binned: ViewerFile = { ...plain, path: 'C:\\$Recycle.Bin\\S-1\\$RABC.txt', binned: { from: 'C:\\a', at: 1 } }

// One helper answers "may this be written?" for every kind of file that is
// not simply a file on disk (Recycle Bin, D12; spec section 4): the seven
// `member` sites call it, so the next kind cannot be forgotten.
describe('readOnlyFile', () => {
  it.each([
    ['a plain file', plain, false],
    ['a zip member', member, true],
    ['a binned file', binned, true]
  ])('%s', (_name, file, expected) => {
    expect(readOnlyFile(file)).toBe(expected)
  })
})

describe('a binned file at the sites that treated a member specially', () => {
  it('gets no thumbnail, as a member gets none', () => {
    const image = { ...binned, ext: '.png', kind: 'image' as const }
    expect(thumbSource({ isFolder: false, file: image })).toBeNull()
    expect(thumbSource({ isFolder: false, file: { ...image, binned: undefined } })).toBe('main')
  })
  it('is never handed to Windows, whatever its kind', () => {
    expect(goesToWindows({ kind: 'other', binned: { from: 'C:\\a', at: 1 } })).toBe(false)
    expect(goesToWindows({ kind: 'other' })).toBe(true)
  })
})
