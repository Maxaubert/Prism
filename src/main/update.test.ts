import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '0.7.0', isPackaged: false } }))

const { newerVersion, isReleaseAssetUrl } = await import('./update')

describe('newerVersion', () => {
  it('orders plain x.y.z triples', () => {
    expect(newerVersion('0.7.1', '0.7.0')).toBe(true)
    expect(newerVersion('0.8.0', '0.7.9')).toBe(true)
    expect(newerVersion('1.0.0', '0.9.9')).toBe(true)
    expect(newerVersion('0.7.0', '0.7.0')).toBe(false)
    expect(newerVersion('0.6.9', '0.7.0')).toBe(false)
  })
  it('accepts a v prefix, the way tags are spelled', () => {
    expect(newerVersion('v0.7.1', '0.7.0')).toBe(true)
    expect(newerVersion('v0.7.0', 'v0.7.0')).toBe(false)
  })
  it('never lets a malformed tag claim to be an upgrade', () => {
    expect(newerVersion('nightly', '0.7.0')).toBe(false)
    expect(newerVersion('', '0.7.0')).toBe(false)
  })
})

describe('isReleaseAssetUrl', () => {
  it("accepts only this repo's release installers", () => {
    expect(
      isReleaseAssetUrl('https://github.com/Maxaubert/Prism/releases/download/v0.7.1/Prism-Setup-x64-0.7.1.exe')
    ).toBe(true)
    expect(isReleaseAssetUrl('https://github.com/evil/repo/releases/download/v1/x.exe')).toBe(false)
    expect(isReleaseAssetUrl('https://example.com/Prism-Setup-x64-0.7.1.exe')).toBe(false)
    expect(
      isReleaseAssetUrl('http://github.com/Maxaubert/Prism/releases/download/v0.7.1/a.exe')
    ).toBe(false)
  })
})
