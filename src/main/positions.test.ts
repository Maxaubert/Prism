import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Positions, applyPatch, parsePositions, prunePositions, POSITIONS_CAP } from './positions'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'prism-pos-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('parsePositions', () => {
  it('keeps sane entries and drops the rest', () => {
    const m = parsePositions(
      JSON.stringify({
        'c:\\a.mkv': { t: 120, at: 5 },
        'c:\\b.mkv': { t: -1 },
        'c:\\c.mkv': { audio: 2, subs: null, fit: 'fill', at: 1 },
        'c:\\d.mkv': { at: 3 },
        x: 'no',
        '': { t: 1 }
      })
    )
    expect([...m.keys()]).toEqual(['c:\\a.mkv', 'c:\\c.mkv'])
    expect(m.get('c:\\a.mkv')).toEqual({ t: 120, at: 5 })
    expect(m.get('c:\\c.mkv')).toEqual({ audio: 2, subs: null, fit: 'fill', at: 1 })
    expect(parsePositions('nonsense').size).toBe(0)
    expect(parsePositions('[]').size).toBe(0)
  })
})

describe('applyPatch', () => {
  it('lays a patch over a record: a value sets, null clears, absent leaves alone', () => {
    const base = applyPatch(undefined, { t: 10, audio: 2, subs: 'C:\\a.srt', fit: 'fill' }, 1)
    expect(base).toEqual({ t: 10, audio: 2, subs: 'C:\\a.srt', fit: 'fill', at: 1 })
    expect(applyPatch(base, { t: null }, 2)).toEqual({ audio: 2, subs: 'C:\\a.srt', fit: 'fill', at: 2 })
    expect(applyPatch(base, { audio: null, subs: null }, 3)).toEqual({ t: 10, audio: null, subs: null, fit: 'fill', at: 3 })
    expect(applyPatch(base, { fit: null }, 4)).toEqual({ t: 10, audio: 2, subs: 'C:\\a.srt', at: 4 })
    expect(applyPatch(base, {}, 5)).toEqual({ ...base, at: 5 })
  })
})

describe('prunePositions', () => {
  it('keeps the newest entries up to the cap', () => {
    const m = new Map<string, { t: number; at: number }>()
    for (let i = 0; i < POSITIONS_CAP + 10; i++) m.set(`f${i}`, { t: 1, at: i })
    const kept = prunePositions(m)
    expect(kept.size).toBe(POSITIONS_CAP)
    expect(kept.has('f0')).toBe(false)
    expect(kept.has(`f${POSITIONS_CAP + 9}`)).toBe(true)
  })
})

describe('Positions', () => {
  it('remembers by path, case-insensitively, across a reload from disk', async () => {
    const file = join(dir, 'positions.json')
    const p = new Positions(file, () => 1000)
    expect(await p.get('C:\\Films\\a.mkv')).toBeNull()
    p.set('C:\\Films\\a.mkv', { t: 1234 })
    expect(await p.get('c:\\films\\A.MKV')).toEqual({ t: 1234 })
    await p.flush()
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ 'c:\\films\\a.mkv': { t: 1234, at: 1000 } })
    const again = new Positions(file)
    expect(await again.get('C:\\Films\\a.mkv')).toEqual({ t: 1234 })
  })

  it('keeps the choices beside the place, each set on its own', async () => {
    const p = new Positions(join(dir, 'positions.json'), () => 7)
    p.set('C:\\a.mkv', { t: 40 })
    p.set('C:\\a.mkv', { audio: 2 })
    p.set('C:\\a.mkv', { subs: 'C:\\a.en.srt', fit: 'fill' })
    expect(await p.get('C:\\a.mkv')).toEqual({ t: 40, audio: 2, subs: 'C:\\a.en.srt', fit: 'fill' })
    // The place clears without touching the choices; a choice clears to
    // null (an explicit "off"), which is itself remembered.
    p.set('C:\\a.mkv', { t: null })
    p.set('C:\\a.mkv', { subs: null })
    expect(await p.get('C:\\a.mkv')).toEqual({ audio: 2, subs: null, fit: 'fill' })
  })

  it('forgets on null, and a set before the file is read wins over the file', async () => {
    const file = join(dir, 'positions.json')
    writeFileSync(file, JSON.stringify({ 'c:\\a.mkv': { t: 50, at: 1 }, 'c:\\b.mkv': { t: 60, at: 1 } }))
    const p = new Positions(file, () => 2)
    p.set('C:\\a.mkv', { t: 99 })
    p.set('C:\\b.mkv', { t: null })
    expect(await p.get('c:\\a.mkv')).toEqual({ t: 99 })
    expect(await p.get('c:\\b.mkv')).toBeNull()
    await p.flush()
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ 'c:\\a.mkv': { t: 99, at: 2 } })
  })

  it('follows a rename or move, so a tidied film keeps its place and choices', async () => {
    const p = new Positions(join(dir, 'positions.json'), () => 3)
    p.set('C:\\a.mkv', { t: 40, audio: 2 })
    await p.rename('C:\\a.mkv', 'C:\\films\\a.mkv')
    expect(await p.get('C:\\a.mkv')).toBeNull()
    expect(await p.get('C:\\films\\a.mkv')).toEqual({ t: 40, audio: 2 })
    await p.rename('C:\\nothing.mkv', 'C:\\films\\b.mkv') // nothing to carry
    expect(await p.get('C:\\films\\b.mkv')).toBeNull()
  })

  it('survives a missing folder and a broken file', async () => {
    const file = join(dir, 'deep', 'positions.json')
    const p = new Positions(file)
    p.set('x', { t: 5 })
    await p.flush()
    expect(readFileSync(file, 'utf8')).toContain('"x"')
    writeFileSync(file, '{{{')
    expect(await new Positions(file).get('x')).toBeNull()
  })
})
