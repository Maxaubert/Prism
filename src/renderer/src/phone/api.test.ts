import { beforeEach, describe, expect, it } from 'vitest'
import { apiUrl, codeFromLocation, dropLegacyToken, mediaUrl, thumbUrl } from './api'

beforeEach(() => localStorage.clear())

describe('phone api urls', () => {
  it('encodes the path and never puts a token in a url, even when an old one is stored', () => {
    localStorage.setItem('prism.phone.token', 'abc')
    expect(apiUrl('/api/dir', { path: 'C:\\a b' })).toBe('/api/dir?path=C%3A%5Ca+b')
    expect(mediaUrl('C:\\a b.mp4')).toBe('/m/C%3A%5Ca%20b.mp4')
    expect(thumbUrl('C:\\a.jpg')).not.toMatch(/[?&]t=/)
    expect(apiUrl('/api/me')).toBe('/api/me')
  })
  it('removes the token an older page left in storage', () => {
    localStorage.setItem('prism.phone.token', 'abc')
    dropLegacyToken()
    expect(localStorage.getItem('prism.phone.token')).toBeNull()
  })
  it('asks again for the thumbnail of a picture that can be clear (#477), past the day the phone caches the old black one', () => {
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
