import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PHONE_API, ROUTE, hlsPlaylistPath, mediaPath, routePath } from './phoneWire'

// The phone's URL shapes, once (2026-10-12): the server's switch and the
// page's fetches both read ROUTE, so these pin the strings a phone already
// running an older page still asks for.
describe('the phone wire', () => {
  it('builds the same paths the two sides used to spell', () => {
    expect(routePath(ROUTE.play)).toBe('/api/play')
    expect(routePath(ROUTE.subsRead)).toBe('/api/subs/read')
    expect(routePath(ROUTE.archiveExtract)).toBe('/api/archive/extract')
    expect(mediaPath('C:\\Films\\a b#1.mkv')).toBe(`/m/${encodeURIComponent('C:\\Films\\a b#1.mkv')}`)
    expect(hlsPlaylistPath('0123456789abcdef')).toBe('/hls/0123456789abcdef/index.m3u8')
    expect(PHONE_API).toBe('/api/')
  })

  it('has a server case for every route, and no literal case beside them', () => {
    const server = readFileSync(join(__dirname, '../main/phone/server.ts'), 'utf8')
    for (const k of Object.keys(ROUTE)) expect(server, k).toContain(`case ROUTE.${k}:`)
    expect(server.match(/case '[^']+':/g) ?? []).toEqual([])
  })
})
