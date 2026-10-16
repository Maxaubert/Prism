import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { copyCounted, pastesIntoItself } from './pasteCopy'

describe('pastesIntoItself (2026-10-16)', () => {
  it('refuses a folder pasted into itself or anywhere below it', () => {
    expect(pastesIntoItself('C:\\a', 'C:\\a')).toBe(true)
    expect(pastesIntoItself('C:\\a', 'C:\\a\\b\\c')).toBe(true)
    expect(pastesIntoItself('C:\\A\\', 'c:/a/b')).toBe(true)
  })

  it('lets a copy land beside its source, or in a sibling that shares a prefix', () => {
    expect(pastesIntoItself('C:\\a', 'C:\\')).toBe(false)
    expect(pastesIntoItself('C:\\a\\f.txt', 'C:\\a')).toBe(false)
    expect(pastesIntoItself('C:\\a', 'C:\\ab')).toBe(false)
  })
})

describe('copyCounted', () => {
  it('copies a folder whole and counts its bytes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'prism-paste-'))
    mkdirSync(join(root, 'src', 'inner'), { recursive: true })
    writeFileSync(join(root, 'src', 'a.txt'), 'abc')
    writeFileSync(join(root, 'src', 'inner', 'b.txt'), 'de')
    let bytes = 0
    await copyCounted(join(root, 'src'), join(root, 'out'), (n) => (bytes += n))
    expect(readFileSync(join(root, 'out', 'inner', 'b.txt'), 'utf8')).toBe('de')
    expect(bytes).toBe(5)
  })

  it('lists the source before making the target, so a copy into its own child does not copy itself', async () => {
    const root = mkdtempSync(join(tmpdir(), 'prism-paste-'))
    const a = join(root, 'A')
    mkdirSync(a)
    writeFileSync(join(a, 'f.txt'), 'x')
    await copyCounted(a, join(a, 'A'), () => {})
    expect(readdirSync(join(a, 'A')).sort()).toEqual(['f.txt'])
  }, 10_000)
})
