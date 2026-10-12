import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { latestWriter, writeAtomic, writeAtomicSync } from './latestWrite'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'prism-latest-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('latestWriter', () => {
  it('lands the newest of many quick writes, and leaves no tmp file', async () => {
    const file = join(dir, 'state.json')
    const w = latestWriter(() => file)
    await Promise.all(Array.from({ length: 20 }, (_, i) => w.write(String(i))))
    expect(readFileSync(file, 'utf8')).toBe('19')
    expect(readdirSync(dir)).toEqual(['state.json'])
  })

  it('a write asked for after the last one finished still lands', async () => {
    const file = join(dir, 'state.json')
    const w = latestWriter(() => file)
    await w.write('a')
    await w.write('b')
    expect(readFileSync(file, 'utf8')).toBe('b')
  })

  it('a write in flight never lands over the quit flush', async () => {
    const file = join(dir, 'state.json')
    const w = latestWriter(() => file)
    const late = w.write('old')
    w.flushSync('quit')
    await late
    expect(readFileSync(file, 'utf8')).toBe('quit')
    expect(readdirSync(dir)).toEqual(['state.json'])
  })

  it('a folder that cannot be written is quiet', async () => {
    const w = latestWriter(() => join(dir, 'missing', 'state.json'))
    await expect(w.write('x')).resolves.toBeUndefined()
    expect(() => w.flushSync('x')).not.toThrow()
  })
})

describe('writeAtomic', () => {
  it('swaps the new text in and leaves no tmp file', async () => {
    const file = join(dir, 'state.json')
    writeFileSync(file, 'old')
    await expect(writeAtomic(file, 'new')).resolves.toBe(true)
    expect(readFileSync(file, 'utf8')).toBe('new')
    expect(readdirSync(dir)).toEqual(['state.json'])
  })

  it('a stale write (keep says no) leaves the old file and no tmp', async () => {
    const file = join(dir, 'state.json')
    writeFileSync(file, 'old')
    await expect(writeAtomic(file, 'new', { keep: () => false })).resolves.toBe(false)
    expect(readFileSync(file, 'utf8')).toBe('old')
    expect(readdirSync(dir)).toEqual(['state.json'])
  })

  it('writes through the tmp path it is given', async () => {
    const file = join(dir, 'state.json')
    await writeAtomic(file, 'x', { tmp: join(dir, 'mine.tmp') })
    expect(readFileSync(file, 'utf8')).toBe('x')
    expect(readdirSync(dir)).toEqual(['state.json'])
  })

  it('throws when the folder is missing, for the caller to judge', async () => {
    await expect(writeAtomic(join(dir, 'missing', 'state.json'), 'x')).rejects.toThrow()
    expect(() => writeAtomicSync(join(dir, 'missing', 'state.json'), 'x')).toThrow()
  })

  it('the sync form swaps in too, with no tmp left', () => {
    const file = join(dir, 'state.json')
    writeFileSync(file, 'old')
    writeAtomicSync(file, 'quit')
    expect(readFileSync(file, 'utf8')).toBe('quit')
    expect(readdirSync(dir)).toEqual(['state.json'])
  })
})
