import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { insideSelf, moveEntries } from './moveOps'

let root: string
const trash = vi.fn(async () => {})

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'prism-move-'))
  mkdirSync(join(root, 'dest'))
  mkdirSync(join(root, 'stuff', 'inner'), { recursive: true })
  writeFileSync(join(root, 'a.txt'), 'A')
  writeFileSync(join(root, 'b.txt'), 'B')
  writeFileSync(join(root, 'stuff', 'inner', 'deep.txt'), 'deep')
  trash.mockClear()
})

describe('insideSelf', () => {
  it('catches a folder being moved into itself or its own subtree', () => {
    expect(insideSelf('C:\\a', 'C:\\a')).toBe(true)
    expect(insideSelf('C:\\a', 'C:\\a\\b')).toBe(true)
    expect(insideSelf('C:\\a', 'C:\\ab')).toBe(false)
    expect(insideSelf('C:\\a', 'C:\\b')).toBe(false)
  })
})

describe('moveEntries', () => {
  it('moves files and reports where they landed', async () => {
    const r = await moveEntries([join(root, 'a.txt')], join(root, 'dest'), 'ask', trash)
    expect(r.moved).toEqual([{ from: join(root, 'a.txt'), to: join(root, 'dest', 'a.txt') }])
    expect(existsSync(join(root, 'a.txt'))).toBe(false)
    expect(readFileSync(join(root, 'dest', 'a.txt'), 'utf8')).toBe('A')
  })

  it('moves a folder whole, contents and all', async () => {
    await moveEntries([join(root, 'stuff')], join(root, 'dest'), 'ask', trash)
    expect(readFileSync(join(root, 'dest', 'stuff', 'inner', 'deep.txt'), 'utf8')).toBe('deep')
    expect(existsSync(join(root, 'stuff'))).toBe(false)
  })

  it("with 'ask' a clash moves NOTHING, so the user answers first", async () => {
    writeFileSync(join(root, 'dest', 'a.txt'), 'old')
    const r = await moveEntries(
      [join(root, 'a.txt'), join(root, 'b.txt')],
      join(root, 'dest'),
      'ask',
      trash
    )
    expect(r.clashes.map((c) => c.name)).toEqual(['a.txt'])
    expect(r.moved).toEqual([])
    expect(existsSync(join(root, 'b.txt'))).toBe(true)
  })

  it("'keep-both' lands the arrival beside what was there", async () => {
    writeFileSync(join(root, 'dest', 'a.txt'), 'old')
    const r = await moveEntries([join(root, 'a.txt')], join(root, 'dest'), 'keep-both', trash)
    expect(r.moved).toEqual([{ from: join(root, 'a.txt'), to: join(root, 'dest', 'a (2).txt') }])
    expect(readFileSync(join(root, 'dest', 'a.txt'), 'utf8')).toBe('old')
  })

  it("'replace' bins what it overwrites rather than destroying it", async () => {
    writeFileSync(join(root, 'dest', 'a.txt'), 'old')
    await moveEntries([join(root, 'a.txt')], join(root, 'dest'), 'replace', trash)
    expect(trash).toHaveBeenCalledWith(join(root, 'dest', 'a.txt'))
    expect(readFileSync(join(root, 'dest', 'a.txt'), 'utf8')).toBe('A')
  })

  it('refuses a folder dropped into itself, and shrugs at its own folder', async () => {
    const self = await moveEntries([join(root, 'stuff')], join(root, 'stuff', 'inner'), 'ask', trash)
    expect(self.failed).toEqual([join(root, 'stuff')])
    expect(existsSync(join(root, 'stuff', 'inner'))).toBe(true)
    // Dropping something where it already lives is a no-op, not a failure.
    const same = await moveEntries([join(root, 'a.txt')], root, 'ask', trash)
    expect(same).toEqual({ moved: [], clashes: [], failed: [] })
  })

  it('fails everything when the destination is not a folder', async () => {
    const r = await moveEntries([join(root, 'a.txt')], join(root, 'nope'), 'ask', trash)
    expect(r.failed).toEqual([join(root, 'a.txt')])
  })
})
