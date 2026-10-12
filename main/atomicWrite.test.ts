import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { writeAtomic } from './atomicWrite'

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
