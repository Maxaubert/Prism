import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { nameError, renameFile, uniqueName } from './fileOps'

function folder(...names: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'prism-ops-'))
  names.forEach((n) => writeFileSync(join(dir, n), n))
  return dir
}

describe('nameError', () => {
  it('accepts ordinary names, spaces and hyphens included', () => {
    for (const n of ['a.jpg', 'Holiday photo 2.png', 'my-file_v2.mp4', 'no extension']) {
      expect(nameError(n)).toBeNull()
    }
  })

  it('rejects the characters Windows forbids', () => {
    for (const n of ['a/b.jpg', 'a\\b.jpg', 'a:b.jpg', 'a*b.jpg', 'a?b.jpg', 'a"b.jpg', 'a<b.jpg', 'a>b.jpg', 'a|b.jpg']) {
      expect(nameError(n)).not.toBeNull()
    }
  })

  it('rejects empty, dot names, reserved names and trailing stops', () => {
    expect(nameError('')).not.toBeNull()
    expect(nameError('   ')).not.toBeNull()
    expect(nameError('..')).not.toBeNull()
    expect(nameError('CON')).not.toBeNull()
    expect(nameError('nul.txt')).not.toBeNull()
    expect(nameError('name.')).not.toBeNull()
    expect(nameError('x'.repeat(256))).not.toBeNull()
  })
})

describe('uniqueName', () => {
  it('returns the name when nothing holds it', () => {
    expect(uniqueName(folder(), 'a.jpg')).toBe('a.jpg')
  })

  it('counts up past every taken name, suffixing before the extension', () => {
    const dir = folder('a.jpg', 'a (2).jpg', 'a (3).jpg')
    expect(uniqueName(dir, 'a.jpg')).toBe('a (4).jpg')
  })

  it('handles names with no extension', () => {
    expect(uniqueName(folder('README'), 'README')).toBe('README (2)')
  })
})

describe('renameFile', () => {
  const noTrash = vi.fn(async () => {})

  it('renames a file', async () => {
    const dir = folder('a.jpg')
    const r = await renameFile(join(dir, 'a.jpg'), 'b.jpg', 'ask', noTrash)
    expect(r).toEqual({ ok: true, path: join(dir, 'b.jpg') })
    expect(existsSync(join(dir, 'b.jpg'))).toBe(true)
    expect(existsSync(join(dir, 'a.jpg'))).toBe(false)
  })

  it('reports a clash and suggests the keep-both name, changing nothing', async () => {
    const dir = folder('a.jpg', 'b.jpg')
    const r = await renameFile(join(dir, 'a.jpg'), 'b.jpg', 'ask', noTrash)
    expect(r).toEqual({ ok: false, reason: 'clash', suggestion: 'b (2).jpg' })
    expect(existsSync(join(dir, 'a.jpg'))).toBe(true)
  })

  it('keeps both by taking the next free name', async () => {
    const dir = folder('a.jpg', 'b.jpg')
    const r = await renameFile(join(dir, 'a.jpg'), 'b.jpg', 'keep-both', noTrash)
    expect(r).toEqual({ ok: true, path: join(dir, 'b (2).jpg') })
    expect(existsSync(join(dir, 'b.jpg'))).toBe(true) // the original is untouched
  })

  it('bins the file it overwrites rather than destroying it', async () => {
    const dir = folder('a.jpg', 'b.jpg')
    const binned: string[] = []
    const r = await renameFile(join(dir, 'a.jpg'), 'b.jpg', 'overwrite', async (p) => {
      binned.push(p)
      const { rmSync } = await import('fs')
      rmSync(p)
    })
    // `replaced` is what undo needs to bring the overwritten file back.
    expect(r).toEqual({ ok: true, path: join(dir, 'b.jpg'), replaced: join(dir, 'b.jpg') })
    expect(binned).toEqual([join(dir, 'b.jpg')])
  })

  it('treats a capitalisation-only change as the same file, not a clash', async () => {
    const dir = folder('photo.jpg')
    const r = await renameFile(join(dir, 'photo.jpg'), 'Photo.jpg', 'ask', noTrash)
    expect(r).toEqual({ ok: true, path: join(dir, 'Photo.jpg') })
  })

  it('refuses an invalid name without touching the file', async () => {
    const dir = folder('a.jpg')
    const r = await renameFile(join(dir, 'a.jpg'), 'sub/b.jpg', 'ask', noTrash)
    expect(r.ok).toBe(false)
    expect(existsSync(join(dir, 'a.jpg'))).toBe(true)
  })

  it('refuses to move the file out of its folder', async () => {
    const dir = folder('a.jpg')
    const r = await renameFile(join(dir, 'a.jpg'), '..\\escaped.jpg', 'ask', noTrash)
    expect(r.ok).toBe(false)
    expect(existsSync(join(dir, 'a.jpg'))).toBe(true)
  })

  it('reports a missing source', async () => {
    const r = await renameFile(join(folder(), 'nope.jpg'), 'b.jpg', 'ask', noTrash)
    expect(r).toEqual({ ok: false, reason: 'missing' })
  })
})
