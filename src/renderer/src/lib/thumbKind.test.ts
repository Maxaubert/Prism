import { describe, expect, it } from 'vitest'
import { fileKind, imageExtensions } from '@shared/fileKind'
import { SVG_MAX_BYTES, thumbSource, visibleWants } from './thumbKind'

const file = (ext: string, size: number | null = 1000, extra: object = {}) => ({
  isFolder: false,
  file: { path: `C:\\x\\a${ext}`, name: `a${ext}`, ext, kind: fileKind(ext), size: size ?? undefined, ...extra }
})

// Which rows wear a picture (zoom grid, Stage 3). Main makes photos and films;
// the page draws a small SVG itself; everything else keeps its kind icon.
describe('thumbSource', () => {
  it('sends photos, raws, HEIC and films to main', () => {
    for (const ext of ['.jpg', '.png', '.gif', '.webp', '.avif', '.bmp', '.tiff', '.ico', '.psd', '.heic', '.heif', '.cr2', '.nef', '.dng', '.mp4', '.mov', '.mkv', '.webm', '.avi', '.wmv', '.m4v', '.ogv'])
      expect(thumbSource(file(ext)), ext).toBe('main')
  })

  it('classifies every image extension fileKind knows: main, or svg for .svg', () => {
    for (const ext of imageExtensions()) expect(thumbSource(file(ext)), ext).toBe(ext === '.svg' ? 'svg' : 'main')
  })

  it('draws a small SVG from the file and gives a big or unmeasured one the icon', () => {
    expect(thumbSource(file('.svg', 1000))).toBe('svg')
    expect(thumbSource(file('.svg', SVG_MAX_BYTES))).toBe('svg')
    expect(thumbSource(file('.svg', SVG_MAX_BYTES + 1))).toBeNull()
    expect(thumbSource(file('.svg', null))).toBeNull()
    expect(thumbSource(file('.svgz'))).toBeNull()
  })

  it('leaves documents, audio, archives, code and text with their icon', () => {
    for (const ext of ['.pdf', '.docx', '.epub', '.cbz', '.mp3', '.flac', '.zip', '.7z', '.js', '.txt', '.md', '.json'])
      expect(thumbSource(file(ext)), ext).toBeNull()
  })

  it('asks only for main pictures, nearest the middle first, skipping what is being copied', () => {
    const rows = [file('.jpg'), file('.txt'), file('.mp4'), file('.svg'), file('.png'), null, undefined, { isFolder: true, path: 'C:\\x\\d' }].map((r, i) =>
      r && 'file' in r && r.file ? { ...r, path: `C:\\x\\r${i}${r.file.ext}` } : r
    ) as Parameters<typeof visibleWants>[0]
    const rowsOf = (list: typeof rows) => visibleWants(list, 320).map((w) => w.path)
    expect(rowsOf(rows)).toEqual(['C:\\x\\r4.png', 'C:\\x\\r2.mp4', 'C:\\x\\r0.jpg'])
    expect(visibleWants(rows, 640, (p) => p.endsWith('r2.mp4')).map((w) => w.tier)).toEqual([640, 640])
    expect(visibleWants(rows, 320, (p) => p.endsWith('r2.mp4')).map((w) => w.path)).toEqual(['C:\\x\\r4.png', 'C:\\x\\r0.jpg'])
  })

  it('leaves folders, zip members and entries with no file alone', () => {
    expect(thumbSource({ isFolder: true })).toBeNull()
    expect(thumbSource({ isFolder: false })).toBeNull()
    expect(thumbSource(file('.jpg', 1000, { member: true }))).toBeNull()
  })
})
