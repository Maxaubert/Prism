import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { latestWriter } from './latestWrite'

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
