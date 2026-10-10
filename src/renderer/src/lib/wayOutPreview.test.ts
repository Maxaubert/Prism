import { describe, expect, it } from 'vitest'
import { wayOutPreview } from './wayOutPreview'

const dir = 'C:\\Downloads'
const zip = 'C:\\Downloads\\Wind-0.2.2.zip'
const files = [{ path: 'C:\\Downloads\\notes.txt' }, { path: zip }]

describe('wayOutPreview (#334)', () => {
  it('out of a zip to its folder, the zip is previewed again', () => {
    expect(wayOutPreview({ from: zip, to: dir, selected: zip, preview: true, files })).toBe(files[1])
  })

  it('matches paths as Windows does: case and slashes', () => {
    const got = wayOutPreview({
      from: 'c:/downloads/WIND-0.2.2.zip/',
      to: 'C:\\Downloads\\',
      selected: 'c:/downloads/WIND-0.2.2.zip',
      preview: true,
      files
    })
    expect(got).toBe(files[1])
  })

  it('a shut pane stays shut', () => {
    expect(wayOutPreview({ from: zip, to: dir, selected: zip, preview: false, files })).toBeNull()
  })

  it('a folder you came out of is not a file: nothing to preview', () => {
    expect(
      wayOutPreview({ from: `${zip}\\Wind`, to: zip, selected: `${zip}\\Wind`, preview: true, files: [] })
    ).toBeNull()
    const sub = 'C:\\Downloads\\sub'
    expect(wayOutPreview({ from: sub, to: dir, selected: sub, preview: true, files })).toBeNull()
  })

  it('only the way out: a mark that is not where you came from previews nothing', () => {
    expect(
      wayOutPreview({ from: zip, to: dir, selected: 'C:\\Downloads\\notes.txt', preview: true, files })
    ).toBeNull()
    expect(wayOutPreview({ from: zip, to: dir, selected: null, preview: true, files })).toBeNull()
  })

  it('a jump that is not to the direct parent previews nothing', () => {
    expect(wayOutPreview({ from: zip, to: 'C:\\', selected: zip, preview: true, files })).toBeNull()
    expect(wayOutPreview({ from: null, to: dir, selected: zip, preview: true, files })).toBeNull()
  })
})
