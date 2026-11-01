import { describe, expect, it } from 'vitest'
import { NO_CAMERA, photoFacts, pixelsOf } from './photoFacts'

const full = {
  camera: 'Apple iPhone 15 Pro',
  lens: 'iPhone 15 Pro back camera 6.86mm f/1.78',
  exposure: '1/250s  f/1.8  ISO 64  24mm',
  taken: '12/10/2026, 14:03:00',
  colour: 'Display P3',
  gps: { lat: 59.913868123, lon: 10.752245987 },
  dimensions: '4032 x 3024'
}

describe('photoFacts (#78): one shaping for the Properties window and the I card', () => {
  it('the pixels line, then every row in order', () => {
    const f = photoFacts(full, { w: 4032, h: 3024 }, 2_516_582)
    expect(f.line).toBe('4032 × 3024 · 12.2 MP · 2.4 MB')
    expect(f.rows.map((r) => r.label)).toEqual(['Camera', 'Lens', 'Exposure', 'Taken', 'Colour', 'Location'])
    expect(f.rows.map((r) => r.group)).toEqual(['camera', 'camera', 'camera', 'camera', 'place', 'place'])
    expect(f.noCamera).toBe(false)
  })

  it('coordinates to five places, as text', () => {
    const f = photoFacts(full, null, null)
    expect(f.rows.find((r) => r.label === 'Location')?.value).toBe('59.91387, 10.75225')
  })

  it('drops what the file does not have', () => {
    const f = photoFacts({ camera: 'Canon EOS R6', exposure: '1/60s' }, null, null)
    expect(f.rows.map((r) => r.label)).toEqual(['Camera', 'Exposure'])
  })

  it('no camera data: says so, and keeps a colour or a place it does have', () => {
    const f = photoFacts({ colour: 'sRGB' }, { w: 10, h: 10 }, 120)
    expect(f.noCamera).toBe(true)
    expect(f.rows.map((r) => r.label)).toEqual(['Colour'])
    expect(f.line).toBe('10 × 10 · 0.0 MP · 120 B')
    expect(NO_CAMERA).toBe('No camera details in this file')
    expect(photoFacts({}, null, null)).toEqual({ line: '', rows: [], noCamera: true })
  })

  it('the pixels come from the picture when known, else from the metadata', () => {
    expect(pixelsOf({ w: 5, h: 6 }, { dimensions: '4032 x 3024' })).toEqual({ w: 5, h: 6 })
    expect(pixelsOf(null, { dimensions: '4032 x 3024' })).toEqual({ w: 4032, h: 3024 })
    expect(pixelsOf(null, {})).toBeNull()
    expect(pixelsOf(null, undefined)).toBeNull()
  })
})
