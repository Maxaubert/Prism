import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiUrl, codeFromLocation, dropLegacyToken, getOr, mediaUrl, onUnpaired, pairedAnyway, thumbUrl } from './api'

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

const answers = (status: number): void =>
  void vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'no' }), { status }))

describe('a phone the PC forgot', () => {
  it('a 401 on a read tells the shell, and the read still answers its fallback (audit #53)', async () => {
    answers(401)
    const heard = vi.fn()
    const off = onUnpaired(heard)
    expect(await getOr('/api/dir', { path: 'C:\\' }, null)).toBeNull()
    expect(heard).toHaveBeenCalledTimes(1)
    answers(500)
    expect(await getOr('/api/dir', { path: 'C:\\' }, null)).toBeNull()
    expect(heard).toHaveBeenCalledTimes(1)
    off()
  })
  it('after a failed pair only a 401 means unpaired (audit #54)', async () => {
    answers(200)
    expect(await pairedAnyway()).toBe('paired')
    answers(401)
    expect(await pairedAnyway()).toBe('unpaired')
    answers(500)
    expect(await pairedAnyway()).toBe('unknown')
  })
})

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
