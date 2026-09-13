import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Positions, parsePositions, prunePositions, POSITIONS_CAP } from './positions'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'prism-pos-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('parsePositions', () => {
  it('keeps sane entries and drops the rest', () => {
    const m = parsePositions(JSON.stringify({ 'c:\\a.mkv': { t: 120, at: 5 }, 'c:\\b.mkv': { t: -1 }, x: 'no', '': { t: 1 } }))
    expect([...m.keys()]).toEqual(['c:\\a.mkv'])
    expect(m.get('c:\\a.mkv')).toEqual({ t: 120, at: 5 })
    expect(parsePositions('nonsense').size).toBe(0)
    expect(parsePositions('[]').size).toBe(0)
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
    p.set('C:\\Films\\a.mkv', 1234)
    expect(await p.get('c:\\films\\A.MKV')).toBe(1234)
    await p.flush()
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ 'c:\\films\\a.mkv': { t: 1234, at: 1000 } })
    const again = new Positions(file)
    expect(await again.get('C:\\Films\\a.mkv')).toBe(1234)
  })

  it('forgets on null, and a set before the file is read wins over the file', async () => {
    const file = join(dir, 'positions.json')
    writeFileSync(file, JSON.stringify({ 'c:\\a.mkv': { t: 50, at: 1 }, 'c:\\b.mkv': { t: 60, at: 1 } }))
    const p = new Positions(file, () => 2)
    p.set('C:\\a.mkv', 99)
    p.set('C:\\b.mkv', null)
    expect(await p.get('c:\\a.mkv')).toBe(99)
    expect(await p.get('c:\\b.mkv')).toBeNull()
    await p.flush()
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ 'c:\\a.mkv': { t: 99, at: 2 } })
  })

  it('survives a missing folder and a broken file', async () => {
    const file = join(dir, 'deep', 'positions.json')
    const p = new Positions(file)
    p.set('x', 5)
    await p.flush()
    expect(readFileSync(file, 'utf8')).toContain('"x"')
    writeFileSync(file, '{{{')
    expect(await new Positions(file).get('x')).toBeNull()
  })
})
