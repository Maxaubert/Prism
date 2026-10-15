import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { createAtomicWriter, writeAtomic } from './atomicWrite'

describe('writeAtomic (code review 2026-09-24, #18: a crash mid-write lost every tab)', () => {
  it('replaces the file with the new text and leaves no temp file behind', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pt-atomic-'))
    const file = join(dir, 'tabs.json')
    writeFileSync(file, '{"old":true}')
    writeAtomic(file, '{"new":true}')
    expect(readFileSync(file, 'utf8')).toBe('{"new":true}')
    expect(existsSync(`${file}.tmp`)).toBe(false)
  })

  it('creates a file that did not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pt-atomic-'))
    const file = join(dir, 'window.json')
    writeAtomic(file, '{}')
    expect(readFileSync(file, 'utf8')).toBe('{}')
  })
})

// 2026-10-15: a starved disk held main 3 to 6 s on the synchronous saves.
describe('createAtomicWriter: saves off the main thread, the close still at once', () => {
  const tmp = (): string => join(mkdtempSync(join(tmpdir(), 'pt-atomic-')), 'tabs.json')

  it('save writes the file, after the call returns', async () => {
    const file = tmp()
    const w = createAtomicWriter(file)
    w.save('{"a":1}')
    expect(existsSync(file)).toBe(false)
    await w.idle()
    expect(readFileSync(file, 'utf8')).toBe('{"a":1}')
    expect(existsSync(`${file}.tmp`)).toBe(false)
  })

  it('of a burst of saves, the newest is what stays', async () => {
    const file = tmp()
    const w = createAtomicWriter(file)
    for (let i = 1; i <= 20; i += 1) w.save(`{"n":${i}}`)
    await w.idle()
    expect(readFileSync(file, 'utf8')).toBe('{"n":20}')
  })

  it('saveNow is on disk when it returns, and an older save on its way never lands over it', async () => {
    const file = tmp()
    const w = createAtomicWriter(file)
    w.save('{"old":true}')
    w.saveNow('{"close":true}')
    expect(readFileSync(file, 'utf8')).toBe('{"close":true}')
    await w.idle()
    expect(readFileSync(file, 'utf8')).toBe('{"close":true}')
  })

  it('a save after saveNow lands as usual', async () => {
    const file = tmp()
    const w = createAtomicWriter(file)
    w.saveNow('{"close":true}')
    w.save('{"later":true}')
    await w.idle()
    expect(readFileSync(file, 'utf8')).toBe('{"later":true}')
  })
})
