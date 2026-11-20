import { describe, expect, it } from 'vitest'
import { vendorDirs } from './vendorDirs'

const fwd = (p: string): string => p.replace(/\\/g, '/')

describe('vendorDirs (#537 item 23)', () => {
  it('packaged: resources/<sub> first, then the vendor walk', () => {
    const d = vendorDirs(
      'dwm',
      'dwm',
      true,
      'C:\\app\\resources',
      'C:\\app\\resources\\app.asar'
    ).map(fwd)
    expect(d[0]).toBe('C:/app/resources/dwm')
    expect(d).toContain('C:/app/resources/app.asar/vendor/dwm')
  })
  it('unpackaged: walks up at most four parents', () => {
    const d = vendorDirs('7zip', 'bin', false, '', 'C:\\repo\\out\\main').map(fwd)
    expect(d).toEqual([
      'C:/repo/out/main/vendor/7zip',
      'C:/repo/out/vendor/7zip',
      'C:/repo/vendor/7zip',
      'C:/vendor/7zip'
    ])
  })
})
