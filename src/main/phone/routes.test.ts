import { describe, expect, it } from 'vitest'
import { pairLink, parseRoute, tokenOf } from './routes'

describe('parseRoute', () => {
  it('maps the index and static assets', () => {
    expect(parseRoute('/')).toEqual({ kind: 'static', file: '' })
    expect(parseRoute('/?code=ABC')).toEqual({ kind: 'static', file: '' })
    expect(parseRoute('/assets/phone-abc.js')).toEqual({ kind: 'static', file: 'assets/phone-abc.js' })
    expect(parseRoute('/pdf/cmaps/x.bcmap')).toEqual({ kind: 'static', file: 'pdf/cmaps/x.bcmap' })
  })
  it('refuses a path that climbs', () => {
    expect(parseRoute('/assets/../../main/index.js')).toEqual({ kind: 'none' })
    // The wall decides, not the parser: the media path is handed over as decoded.
    expect(parseRoute('/m/..%5C..%5Cx')).toMatchObject({ kind: 'media', path: '..\\..\\x' })
  })
  it('names the api and pair routes', () => {
    expect(parseRoute('/pair')).toEqual({ kind: 'pair' })
    const r = parseRoute('/api/dir?path=C%3A%5Cfilms&t=abc')
    expect(r.kind).toBe('api')
    if (r.kind === 'api') {
      expect(r.name).toBe('dir')
      expect(r.query.get('path')).toBe('C:\\films')
    }
  })
  it('decodes the media path', () => {
    const r = parseRoute('/m/C%3A%5Cfilms%5Ca%20b.mp4?t=abc')
    expect(r).toMatchObject({ kind: 'media', path: 'C:\\films\\a b.mp4' })
  })
  it('names the hls routes and refuses anything else under them', () => {
    const job = '0123456789abcdef'
    const pl = parseRoute(`/hls/${job}/index.m3u8?t=x`)
    expect(pl).toMatchObject({ kind: 'hls', job, file: 'index.m3u8' })
    if (pl.kind === 'hls') expect(pl.query.get('t')).toBe('x')
    expect(parseRoute(`/hls/${job}/12.m4s`)).toMatchObject({ kind: 'hls', job, file: '12.m4s' })
    expect(parseRoute(`/hls/${job}/init.mp4`)).toMatchObject({ kind: 'hls', job, file: 'init.mp4' })
    // A job id is sixteen lower-case hex characters and nothing else.
    expect(parseRoute('/hls/abc/index.m3u8')).toEqual({ kind: 'none' })
    expect(parseRoute('/hls/0123456789ABCDEF/index.m3u8')).toEqual({ kind: 'none' })
    // Only the three file shapes the job directory is known to hold.
    expect(parseRoute(`/hls/${job}/../x`)).toEqual({ kind: 'none' })
    expect(parseRoute(`/hls/${job}/..%2Fx`)).toEqual({ kind: 'none' })
    expect(parseRoute(`/hls/${job}/ffmpeg.m3u8`)).toEqual({ kind: 'none' })
    expect(parseRoute(`/hls/${job}/1.m4s.tmp`)).toEqual({ kind: 'none' })
    expect(parseRoute(`/hls/${job}/`)).toEqual({ kind: 'none' })
    expect(parseRoute(`/hls/${job}`)).toEqual({ kind: 'none' })
  })
})

describe('tokenOf', () => {
  it('prefers the bearer header, falls back to the query', () => {
    expect(tokenOf(new URLSearchParams('t=q'), 'Bearer h')).toBe('h')
    expect(tokenOf(new URLSearchParams('t=q'), undefined)).toBe('q')
    expect(tokenOf(new URLSearchParams(''), undefined)).toBeNull()
  })
})

describe('pairLink', () => {
  it('is the page with the code in the query', () => {
    expect(pairLink('192.168.1.5', 47320, 'ABCDEF')).toBe('http://192.168.1.5:47320/?code=ABCDEF')
  })
})
