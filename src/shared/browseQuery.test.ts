import { describe, expect, it } from 'vitest'
import { nativeBrowseQuery, parseBrowseQuery } from './browseQuery'

describe('Explorer fallback search', () => {
  it('matches words in any order and quoted phrases literally', () => {
    const words = parseBrowseQuery('holiday 2026')
    expect(words.matches('2026 summer HOLIDAY.jpg', false)).toBe(true)
    expect(words.matches('holiday.jpg', false)).toBe(false)
    const phrase = parseBrowseQuery('"family dinner"')
    expect(phrase.matches('family dinner.jpg', false)).toBe(true)
    expect(phrase.matches('family holiday dinner.jpg', false)).toBe(false)
    expect(parseBrowseQuery('"2 * 3.txt"').matches('2 * 3.txt', false)).toBe(true)
    expect(parseBrowseQuery('"2 * 3.txt"').matches('2 times 3.txt', false)).toBe(false)
  })

  it.each(['folder: playnite', 'folder:playnite', 'FOLDER:PLAYNITE'])(
    '%s only matches folders',
    (query) => {
      const parsed = parseBrowseQuery(query)
      expect(parsed.matches('Playnite', true)).toBe(true)
      expect(parsed.matches('Playnite.exe', false)).toBe(false)
      expect(parsed.matches('Games', true)).toBe(false)
    }
  )

  it('supports bare file/folder filters and attached quoted names', () => {
    expect(parseBrowseQuery('folder:').matches('Anything', true)).toBe(true)
    expect(parseBrowseQuery('folder:').matches('Anything', false)).toBe(false)
    expect(parseBrowseQuery('file:').matches('Anything', false)).toBe(true)
    expect(parseBrowseQuery('file: report').matches('report.dll', false)).toBe(true)
    expect(parseBrowseQuery('file:report').matches('report', true)).toBe(false)
    expect(parseBrowseQuery('folder:"Saved Games"').matches('My Saved Games', true)).toBe(true)
  })

  it('combines extension lists, glob patterns and exclusions', () => {
    const query = parseBrowseQuery('file: *.d?? ext:exe;dll -.bak !installer')
    expect(query.matches('game.dll', false)).toBe(true)
    expect(query.matches('game.exe', false)).toBe(false)
    expect(query.matches('game.dat', false)).toBe(false)
    expect(query.matches('game.bak.dll', false)).toBe(false)
    expect(query.matches('installer.dll', false)).toBe(false)
    expect(parseBrowseQuery('ext:.DLL;EXE').matches('game.dll', false)).toBe(true)
    expect(parseBrowseQuery('ext:dll').matches('folder.dll', true)).toBe(false)
    expect(parseBrowseQuery('ext:git').matches('.git', false)).toBe(true)
  })

  it('negates attached folder/file predicates as a unit', () => {
    const query = parseBrowseQuery('!folder:temp')
    expect(query.matches('temporary', true)).toBe(false)
    expect(query.matches('temporary.txt', false)).toBe(true)
    expect(query.matches('Pictures', true)).toBe(true)
    expect(parseBrowseQuery('-"family dinner"').matches('family dinner.jpg', false)).toBe(false)
    expect(parseBrowseQuery('!"family dinner"').matches('family lunch.jpg', false)).toBe(true)
  })

  it.each([
    'foo | bar',
    '<foo bar>',
    'size:>10mb',
    'dm:today',
    'regex:foo',
    'path:foo',
    'foo\\bar',
    'foo!bar',
    '"quoted"*',
    'folder:regex:x',
    'ext:',
    'ext:jp*'
  ])('reports unsupported syntax: %s', (query) => {
    const parsed = parseBrowseQuery(query)
    expect(parsed.error).toContain('Everything')
    expect(parsed.matches('anything', false)).toBe(false)
  })

  it('keeps quoted operator characters literal and rejects incomplete phrases', () => {
    expect(parseBrowseQuery('"size:large"').error).toBeUndefined()
    expect(parseBrowseQuery('"size:large"').matches('size:large', false)).toBe(true)
    expect(parseBrowseQuery('"unfinished').error).toContain('quotation')
    expect(parseBrowseQuery('   ').matches('anything', false)).toBe(false)
  })
})

describe('native Explorer query', () => {
  it('translates legacy exclusions without altering native syntax', () => {
    expect(nativeBrowseQuery('folder: playnite -installer -"saved games"')).toBe(
      'folder: playnite !installer !"saved games"'
    )
    expect(nativeBrowseQuery('<foo | -bar> size:1mb-2mb dm:2026-09-01')).toBe(
      '<foo | !bar> size:1mb-2mb dm:2026-09-01'
    )
  })

  it('preserves quoted text, native negation, regexes and literal hyphens', () => {
    const query = '"-file name" "some -text" !folder:cache regex:foo|-bar file-name -'
    expect(nativeBrowseQuery(query)).toBe(query)
    expect(nativeBrowseQuery('"x -foo" -bar')).toBe('"x -foo" !bar')
  })
})
