import { describe, expect, it } from 'vitest'
import { comicPages } from './comicPages'

const of = (...paths: string[]): { path: string }[] => paths.map((path) => ({ path }))

describe('the pages of a comic, in order', () => {
  it('sorts numerically, so page 10 comes after page 2', () => {
    // The whole reason this is not a plain localeCompare. Unpadded numbering
    // is at least as common in real comics as padded.
    expect(comicPages(of('page10.jpg', 'page2.jpg', 'page1.jpg'))).toEqual([
      'page1.jpg',
      'page2.jpg',
      'page10.jpg'
    ])
  })

  it('handles padded numbering too', () => {
    expect(comicPages(of('010.png', '002.png', '001.png'))).toEqual(['001.png', '002.png', '010.png'])
  })

  it('reads chapter folders through in order rather than interleaving them', () => {
    expect(
      comicPages(of('ch02/001.jpg', 'ch01/002.jpg', 'ch01/001.jpg', 'ch10/001.jpg'))
    ).toEqual(['ch01/001.jpg', 'ch01/002.jpg', 'ch02/001.jpg', 'ch10/001.jpg'])
  })

  it('leaves out everything that is not a picture', () => {
    // ComicInfo.xml is in most comics off a scanner, and shown as page one it
    // reads as a broken file rather than as metadata.
    expect(comicPages(of('ComicInfo.xml', '001.jpg', 'notes.txt'))).toEqual(['001.jpg'])
  })

  it('leaves out the macOS resource forks, which really are named .jpg', () => {
    expect(comicPages(of('__MACOSX/._001.jpg', '001.jpg'))).toEqual(['001.jpg'])
  })

  it('leaves out hidden files and Windows clutter', () => {
    expect(comicPages(of('.DS_Store', 'Thumbs.db', 'desktop.ini', '001.jpg'))).toEqual(['001.jpg'])
    expect(comicPages(of('.hidden/001.jpg', '001.jpg'))).toEqual(['001.jpg'])
  })

  it('leaves out directory entries', () => {
    expect(comicPages([{ path: 'ch01', dir: true }, { path: 'ch01/001.jpg' }])).toEqual([
      'ch01/001.jpg'
    ])
  })

  it('normalises backslashes, which is how 7-Zip reports them', () => {
    expect(comicPages(of('ch01\\002.jpg', 'ch01\\001.jpg'))).toEqual(['ch01/001.jpg', 'ch01/002.jpg'])
  })

  it('takes every picture format Prism can show, not just jpeg', () => {
    expect(comicPages(of('a.webp', 'b.png', 'c.avif')).length).toBe(3)
  })

  it('has no pages for an empty container', () => {
    expect(comicPages([])).toEqual([])
  })
})
