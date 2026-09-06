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
