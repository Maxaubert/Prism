import { describe, expect, it } from 'vitest'
import { applyCarry, buffersLeaving, carryOf, ownedBufferKeys, type CarrySinks, type CarrySources } from './tabCarry'
import { newTab, type Tab } from './tabs'
import { newBrowse } from '../browse'
import type { ViewerFile } from '@shared/types'

// What a torn-off tab takes to its new window (tab tear-off step 3, 2026-10-29),
// round-tripped through fake stores.

const file = (path: string): ViewerFile => ({
  path,
  name: path.split('\\').pop() ?? path,
  ext: '.' + (path.split('.').pop() ?? ''),
  kind: 'video',
  size: 1,
  mtimeMs: 1
})
const film = 'C:\\films\\a.mkv'
const notes = 'C:\\films\\notes.txt'
function tabAt(id: string, index = 0): Tab {
  const t = newTab({ root: 'C:\\films', files: [file(film), file(notes)], index }, id)
  return { ...t, browse: { ...newBrowse('C:\\films', 'viewer'), preview: true } }
}

function sources(over: Partial<CarrySources> = {}): CarrySources {
  return {
    buffers: new Map([
      [notes.toLowerCase(), { path: notes, text: 'mine' }],
      ['c:\\other\\b.txt', { path: 'C:\\other\\b.txt', text: 'theirs' }]
    ]),
    owners: new Map([['t1', new Set([notes.toLowerCase()])]]),
    level: () => ({ vol: 0.3, muted: true }),
    rate: () => 1.5,
    mediaKey: (p) => `fsmedia://local/${encodeURIComponent(p)}`,
    mark: (k) => (k.includes('a.mkv') ? { t: 42.5, paused: false } : undefined),
    docPos: () => 0,
    passwords: (paths) => (paths.some((p) => p.startsWith('C:\\films')) ? [{ path: 'c:\\films\\x.zip', password: 'pw' }] : []),
    listing: (p) => ({ path: p, listing: { files: [], folders: [] } as never }),
    ...over
  }
}

describe('carrying a tab', () => {
  it('takes the tab itself, the same id', () => {
    const c = carryOf(tabAt('t1'), sources())
    expect(c.tab).toMatchObject({ id: 't1', root: 'C:\\films', index: 0 })
    expect(c.tab.files).toHaveLength(2)
    expect(c.tab.browse.preview).toBe(true)
  })
  it('takes the unsaved text it owns, and only that', () => {
    expect(carryOf(tabAt('t1'), sources()).buffers).toEqual([{ path: notes, text: 'mine' }])
  })
  it('takes the text of the file it shows even if another tab typed it', () => {
    const c = carryOf(tabAt('t9', 1), sources())
    expect(c.buffers).toEqual([{ path: notes, text: 'mine' }])
  })
  it('takes its volume, mute and speed', () => {
    expect(carryOf(tabAt('t1'), sources()).level).toEqual({ vol: 0.3, muted: true, rate: 1.5 })
  })
  it('takes where its film had got to, and that it was playing', () => {
    expect(carryOf(tabAt('t1'), sources()).marks).toEqual([
      { key: `fsmedia://local/${encodeURIComponent(film)}`, t: 42.5, paused: false }
    ])
  })
  it('takes a document’s place, the passwords given for it, and the listing on screen', () => {
    const c = carryOf(tabAt('t1', 1), sources({ docPos: () => 1200 }))
    expect(c.docPos).toEqual([{ key: notes, value: 1200 }])
    expect(c.passwords).toEqual([{ path: 'c:\\films\\x.zip', password: 'pw' }])
    expect(c.listing?.path).toBe('C:\\films')
  })
  it('carries nothing it does not have', () => {
    const c = carryOf(tabAt('t1', -1), sources({ mark: () => undefined, listing: () => null }))
    expect(c.marks).toBeUndefined()
    expect(c.docPos).toBeUndefined()
    expect(c.listing).toBeUndefined()
  })
})

describe('arriving with it', () => {
  it('puts it all back and rebuilds the same tab, in front, as the new window’s home', () => {
    const got: string[] = []
    const sinks: CarrySinks = {
      setLevel: (id, l) => got.push(`level ${id} ${l.vol} ${l.muted}`),
      setRate: (id, r) => got.push(`rate ${id} ${r}`),
      rememberTime: (_k, t) => got.push(`time ${t}`),
      rememberPaused: (_k, p) => got.push(`paused ${p}`),
      rememberDocPos: (_k, v) => got.push(`doc ${v}`),
      rememberPassword: (p, pw) => got.push(`pw ${p} ${pw}`)
    }
    const c = carryOf(tabAt('t1'), sources({ docPos: () => 9 }))
    const p = applyCarry(c, sinks)
    expect(got).toEqual(['level t1 0.3 true', 'rate t1 1.5', 'time 42.5', 'paused false', 'doc 9', 'pw c:\\films\\x.zip pw'])
    expect(p).toMatchObject({ restore: true, restoreTabId: 't1', restoreActive: true, pinned: true, index: 0, root: 'C:\\films' })
    expect(newTab(p, 'fresh').id).toBe('t1')
  })
})

describe('what leaves the source page', () => {
  it('is the leaving tab’s text, unless a tab staying behind holds it too', () => {
    const s = sources()
    const leaving = tabAt('t1')
    expect(buffersLeaving(leaving, [tabAt('t2', 0)], s.buffers, s.owners)).toEqual([notes.toLowerCase()])
    expect(buffersLeaving(leaving, [tabAt('t2', 1)], s.buffers, s.owners)).toEqual([])
    expect(ownedBufferKeys(tabAt('t3', 0), s.buffers, s.owners)).toEqual([])
  })
})
