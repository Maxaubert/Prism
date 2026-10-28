import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { copyCounted, movePct, pastesIntoItself, pctOf, predictNames } from './pasteCopy'
import { uniqueNameAsync } from './fileOps'

describe('paste progress arithmetic (review, 2026-10-28)', () => {
  it('a share is 0 to 100, and 0 of nothing', () => {
    expect(pctOf(50, 200)).toBe(25)
    expect(pctOf(300, 200)).toBe(100)
    expect(pctOf(5, 0)).toBe(0)
  })

  it('a cut copied across drives counts in items, never jumping to 100 on the second', () => {
    // Three items, the second copied: half of it done is half way through 1 of 3.
    expect(movePct(1, 3, 50, 100)).toBeCloseTo(50)
    expect(movePct(0, 3, 0, 100)).toBe(0)
    expect(movePct(2, 3, 100, 100)).toBe(100)
    expect(movePct(1, 3, 5000, 100)).toBeCloseTo((2 / 3) * 100)
    expect(movePct(0, 0, 1, 1)).toBe(0)
  })
})

describe('predictNames (review, 2026-10-28)', () => {
  it('gives two sources with one name two landing names, apart from the disk too', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'predict-'))
    writeFileSync(join(dir, 'notes.txt'), 'x')
    const names = await predictNames(['readme.md', 'README.md', 'notes.txt', 'pic.jpg'], (n, taken) =>
      uniqueNameAsync(dir, n, taken)
    )
    expect(names).toEqual(['readme.md', 'README (2).md', 'notes (2).txt', 'pic.jpg'])
  })
})

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
