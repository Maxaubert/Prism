import { describe, expect, it } from 'vitest'
import { isWebUrl } from './webUrl'

describe('isWebUrl', () => {
  it('is http and https with their slashes, any case', () => {
    expect(isWebUrl('https://example.com')).toBe(true)
    expect(isWebUrl('HTTP://example.com/x')).toBe(true)
  })
  it('is nothing else', () => {
    for (const u of ['https:example.com', 'file:///C:/x', 'javascript:alert(1)', 'mailto:a@b', '', null, 42])
      expect(isWebUrl(u), String(u)).toBe(false)
  })
})
