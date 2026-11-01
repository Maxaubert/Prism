import { describe, expect, it } from 'vitest'
import type { DragPayload } from './dragDrop'
import { archiveTarget, dropVerb, effectOf, type DropArchive, type DropKeys } from './dropVerb'

// THE ONE DROP RULE (#70; owner approved the spec "as recommended",
// 2026-11-01). Every target asks it on hover and the drop asks it again, so
// the word under the carried row and the thing done can never differ.

const NONE: DropKeys = { ctrl: false, shift: false }
const CTRL: DropKeys = { ctrl: true, shift: false }
const SHIFT: DropKeys = { ctrl: false, shift: true }
const BOTH: DropKeys = { ctrl: true, shift: true }

const files = (...paths: string[]): DragPayload => ({ kind: 'files', paths })
const windows = (...paths: string[]): DragPayload => ({ kind: 'files', paths, external: true })
const members = (archive: string, base: string, ...entries: string[]): DragPayload => ({
  kind: 'members',
  archive,
  entries,
  places: entries.map((e) => `${base}\\${e.replace(/\//g, '\\')}`)
})

const zip = (base: string, inner = '', extra: Partial<DropArchive> = {}): DropArchive => ({
  container: base,
  base,
  outer: base,
  inner,
  readOnly: false,
  ...extra
})

describe('dropVerb: rows onto a real folder', () => {
  const into = { dir: 'C:\\work\\into' }
  it.each([
    ['plain, same drive', NONE, 'move'],
    ['Ctrl copies', CTRL, 'copy'],
    ['Shift moves', SHIFT, 'move'],
    ['Ctrl and Shift together keep the plain rule', BOTH, 'move']
  ] as const)('%s', (_what, keys, verb) => {
    expect(dropVerb({ payload: files('C:\\work\\a.txt'), target: into, keys })).toBe(verb)
  })

  it.each([
    ['plain, another drive copies', NONE, 'copy'],
    ['Ctrl copies', CTRL, 'copy'],
    ['Shift moves across drives', SHIFT, 'move'],
    ['both: the drive rule', BOTH, 'copy']
  ] as const)('%s', (_what, keys, verb) => {
    expect(dropVerb({ payload: files('D:\\photos\\a.jpg'), target: into, keys })).toBe(verb)
  })

  it('reads a share as its own volume', () => {
    const share = { dir: '\\\\srv\\share\\in' }
    expect(dropVerb({ payload: files('\\\\srv\\share\\x\\a.txt'), target: share, keys: NONE })).toBe('move')
    expect(dropVerb({ payload: files('\\\\srv\\other\\a.txt'), target: share, keys: NONE })).toBe('copy')
    expect(dropVerb({ payload: files('C:\\a.txt'), target: share, keys: NONE })).toBe('copy')
  })

  it('refuses a row onto itself and a folder into itself or below it', () => {
    expect(dropVerb({ payload: files('C:\\work\\into'), target: into, keys: NONE })).toBe('none')
    expect(dropVerb({ payload: files('C:\\work\\into'), target: into, keys: CTRL })).toBe('none')
    expect(dropVerb({ payload: files('C:\\work'), target: into, keys: CTRL })).toBe('none')
  })

  it('refuses a move into the folder it is already in, but a copy there makes "name (2)" (G10)', () => {
    const own = { dir: 'C:\\work' }
    expect(dropVerb({ payload: files('C:\\work\\a.txt'), target: own, keys: NONE })).toBe('none')
    expect(dropVerb({ payload: files('C:\\work\\a.txt'), target: own, keys: SHIFT })).toBe('none')
    expect(dropVerb({ payload: files('C:\\work\\a.txt'), target: own, keys: CTRL })).toBe('copy')
  })

  it('copies files from Windows in, whatever the keys (#103 D3)', () => {
    for (const keys of [NONE, CTRL, SHIFT, BOTH])
      expect(dropVerb({ payload: windows('C:\\work\\a.txt'), target: into, keys })).toBe('copy')
  })

  it('refuses nothing to carry', () => {
    expect(dropVerb({ payload: null, target: into, keys: NONE })).toBe('none')
    expect(dropVerb({ payload: files(), target: into, keys: NONE })).toBe('none')
  })
})

describe('dropVerb: rows onto a zip or a place inside one', () => {
  const box = zip('C:\\work\\box.zip')
  it.each([
    ['plain, same drive: added, originals binned', NONE, 'add-move'],
    ['Ctrl: added, originals stay', CTRL, 'add-copy'],
    ['Shift: added and binned', SHIFT, 'add-move']
  ] as const)('%s', (_what, keys, verb) => {
    expect(dropVerb({ payload: files('C:\\work\\a.txt'), target: { dir: box.base, archive: box }, keys })).toBe(verb)
  })

  it("takes the OUTER zip file's drive (D3)", () => {
    const far = zip('E:\\zips\\box.zip', 'docs')
    expect(dropVerb({ payload: files('C:\\a.txt'), target: { dir: 'E:\\zips\\box.zip\\docs', archive: far }, keys: NONE })).toBe('add-copy')
    expect(dropVerb({ payload: files('C:\\a.txt'), target: { dir: 'E:\\zips\\box.zip\\docs', archive: far }, keys: SHIFT })).toBe('add-move')
    expect(dropVerb({ payload: files('E:\\a.txt'), target: { dir: 'E:\\zips\\box.zip\\docs', archive: far }, keys: NONE })).toBe('add-move')
  })

  it('shows no-drop on a read-only archive (G6)', () => {
    const seven = zip('C:\\work\\box.7z', '', { readOnly: true })
    for (const keys of [NONE, CTRL, SHIFT])
      expect(dropVerb({ payload: files('C:\\work\\a.txt'), target: { dir: seven.base, archive: seven }, keys })).toBe('none')
    expect(dropVerb({ payload: windows('C:\\x.txt'), target: { dir: seven.base, archive: seven }, keys: NONE })).toBe('none')
  })

  it('never puts a zip, or a folder holding it, into itself', () => {
    expect(dropVerb({ payload: files('C:\\work\\box.zip'), target: { dir: box.base, archive: box }, keys: CTRL })).toBe('none')
    expect(dropVerb({ payload: files('C:\\work'), target: { dir: box.base, archive: box }, keys: CTRL })).toBe('none')
  })

  it('adds files from Windows as a copy', () => {
    expect(dropVerb({ payload: windows('C:\\x.txt'), target: { dir: box.base, archive: box }, keys: SHIFT })).toBe('add-copy')
  })
})

describe('dropVerb: zip members', () => {
  const a = 'C:\\work\\a.zip'
  it('extract onto a real folder, whatever the keys', () => {
    for (const keys of [NONE, CTRL, SHIFT, BOTH])
      expect(dropVerb({ payload: members(a, a, 'x.txt'), target: { dir: 'D:\\out' }, keys })).toBe('extract')
  })

  it('move inside their own zip, Ctrl ignored (D10)', () => {
    const docs = { dir: `${a}\\docs`, archive: zip(a, 'docs') }
    for (const keys of [NONE, CTRL, SHIFT])
      expect(dropVerb({ payload: members(a, a, 'x.txt'), target: docs, keys })).toBe('move-inside')
  })

  it('know their own zip by its base when the container is not known (a tab)', () => {
    const docs = { dir: `${a}\\docs`, archive: zip(a, 'docs', { container: null }) }
    expect(dropVerb({ payload: members(a, a, 'x.txt'), target: docs, keys: NONE })).toBe('move-inside')
  })

  it('refuse the folder they are already in, and a folder onto itself', () => {
    const root = { dir: a, archive: zip(a, '') }
    expect(dropVerb({ payload: members(a, a, 'x.txt'), target: root, keys: NONE })).toBe('none')
    const self = { dir: `${a}\\docs`, archive: zip(a, 'docs') }
    expect(dropVerb({ payload: members(a, a, 'docs'), target: self, keys: NONE })).toBe('none')
    const below = { dir: `${a}\\docs\\img`, archive: zip(a, 'docs/img') }
    expect(dropVerb({ payload: members(a, a, 'docs'), target: below, keys: NONE })).toBe('none')
  })

  it('are copied into another zip (D9)', () => {
    const b = 'C:\\work\\b.zip'
    for (const keys of [NONE, CTRL, SHIFT])
      expect(dropVerb({ payload: members(a, a, 'x.txt'), target: { dir: b, archive: zip(b) }, keys })).toBe('zip-to-zip')
  })

  it('show no-drop over a read-only archive, their own or another (G6)', () => {
    const ro = zip(a, 'docs', { readOnly: true })
    expect(dropVerb({ payload: members(a, a, 'x.txt'), target: { dir: `${a}\\docs`, archive: ro }, keys: NONE })).toBe('none')
    const seven = zip('C:\\work\\b.7z', '', { readOnly: true })
    expect(dropVerb({ payload: members(a, a, 'x.txt'), target: { dir: seven.base, archive: seven }, keys: NONE })).toBe('none')
  })
})

describe('effectOf', () => {
  it('maps each verb to the word under the carried row', () => {
    expect(effectOf('move', false)).toBe('move')
    expect(effectOf('add-move', false)).toBe('move')
    expect(effectOf('move-inside', false)).toBe('move')
    expect(effectOf('copy', false)).toBe('copy')
    expect(effectOf('add-copy', false)).toBe('copy')
    expect(effectOf('extract', false)).toBe('copy')
    expect(effectOf('zip-to-zip', false)).toBe('copy')
    expect(effectOf('none', false)).toBe('none')
  })

  it('shows copy for any drag Windows carries: its drag cannot take move (#103)', () => {
    expect(effectOf('move', true)).toBe('copy')
    expect(effectOf('move-inside', true)).toBe('copy')
    expect(effectOf('none', true)).toBe('none')
  })
})

describe('archiveTarget', () => {
  it('is null for an ordinary folder', () => {
    expect(archiveTarget('C:\\work\\into')).toBeNull()
  })

  it('reads a zip row, or a place inside it, from the path alone', () => {
    expect(archiveTarget('C:\\work\\box.zip')).toEqual({
      container: 'C:\\work\\box.zip',
      base: 'C:\\work\\box.zip',
      outer: 'C:\\work\\box.zip',
      inner: '',
      readOnly: false
    })
    expect(archiveTarget('C:\\work\\box.zip\\docs\\img')?.inner).toBe('docs/img')
  })

  it('calls a 7z or rar read-only, and a zip inside a zip too (D6)', () => {
    expect(archiveTarget('C:\\work\\box.7z')?.readOnly).toBe(true)
    expect(archiveTarget('C:\\work\\box.rar')?.readOnly).toBe(true)
    const nested = archiveTarget('C:\\work\\box.zip\\inner.zip\\x')
    expect(nested?.readOnly).toBe(true)
    expect(nested?.outer).toBe('C:\\work\\box.zip')
    expect(nested?.container).toBeNull()
  })

  it("prefers the listing's own answer for a place inside it", () => {
    const meta = {
      container: 'C:\\Temp\\copy.zip',
      base: 'C:\\work\\box.zip\\inner.zip',
      outer: 'C:\\work\\box.zip',
      readOnly: true
    }
    expect(archiveTarget('C:\\work\\box.zip\\inner.zip\\docs', meta)).toEqual({
      container: 'C:\\Temp\\copy.zip',
      base: 'C:\\work\\box.zip\\inner.zip',
      outer: 'C:\\work\\box.zip',
      inner: 'docs',
      readOnly: true
    })
    // A zip ROW inside the listing is its own archive, not a folder of it.
    expect(archiveTarget('C:\\work\\box.zip\\inner.zip\\deeper.zip', meta)?.base).toBe(
      'C:\\work\\box.zip\\inner.zip\\deeper.zip'
    )
  })
})
