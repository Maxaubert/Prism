import { beforeEach, describe, expect, it } from 'vitest'
import { apiUrl, codeFromLocation, mediaUrl, readToken, thumbUrl, writeToken } from './api'

beforeEach(() => localStorage.clear())

describe('phone api urls', () => {
  it('carries the token in the query, and the path encoded', () => {
    writeToken('abc')
    expect(readToken()).toBe('abc')
    expect(apiUrl('/api/dir', { path: 'C:\\a b' })).toBe('/api/dir?path=C%3A%5Ca+b&t=abc')
    expect(mediaUrl('C:\\a b.mp4')).toBe('/m/C%3A%5Ca%20b.mp4?t=abc')
    writeToken(null)
    expect(readToken()).toBeNull()
    expect(apiUrl('/api/me')).toBe('/api/me')
  })
  it('asks again for the thumbnail of a picture that can be clear (#477), past the day the phone caches the old black one', () => {
    writeToken(null)
    expect(thumbUrl('C:\\a.png')).toBe('/api/thumb?path=C%3A%5Ca.png&a=1')
    expect(thumbUrl('C:\\a.jpg')).toBe('/api/thumb?path=C%3A%5Ca.jpg')
  })
  it('reads the pairing code off the link', () => {
    expect(codeFromLocation('?code=ABCDEF')).toBe('ABCDEF')
    expect(codeFromLocation('?code=abcdef')).toBe('ABCDEF')
    expect(codeFromLocation('?x=1')).toBeNull()
    expect(codeFromLocation('')).toBeNull()
  })
})
