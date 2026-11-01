import AdmZip from 'adm-zip'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  addToArchive,
  deleteMember,
  extractMember,
  hasEncrypted,
  listArchive,
  moveMembers,
  renameMember,
  runZipJob
} from './zipOps'
import { sevenZipExe, validMemberName } from './zipShared'

// The zip worker's own code (owner, 2026-10-12, zip work off the main process),
// called directly: the behaviour moved, unchanged, from archive.ts.

let zipPath: string

beforeEach(() => {
  const zip = new AdmZip()
  zip.addFile('readme.txt', Buffer.from('hello'))
  zip.addFile('docs/guide.md', Buffer.from('# guide'))
  zip.addFile('docs/img/logo.png', Buffer.from([0x89, 0x50]))
  zipPath = join(mkdtempSync(join(tmpdir(), 'prism-archive-test-')), 'a.zip')
  zip.writeZip(zipPath)
})

describe('listArchive', () => {
  it('lists files with sizes and derives the folders their paths imply', () => {
    const entries = listArchive(zipPath)
    const byPath = new Map(entries.map((e) => [e.path, e]))
    expect(byPath.get('readme.txt')).toMatchObject({ dir: false, size: 5 })
    expect(byPath.get('docs/guide.md')).toMatchObject({ dir: false, name: 'guide.md' })
    // No folder records were written; both parents still appear.
    expect(byPath.get('docs')).toMatchObject({ dir: true })
    expect(byPath.get('docs/img')).toMatchObject({ dir: true })
  })
})

describe('extractMember', () => {
  it('writes the member to temp under its own name', async () => {
    const r = await extractMember(zipPath, 'docs/guide.md')
    if (!r.ok) throw new Error('expected ok')
    expect(r.path).toMatch(/guide\.md$/)
    expect(readFileSync(r.path, 'utf8')).toBe('# guide')
  })
  it('refuses folders and unknown members', async () => {
    expect(await extractMember(zipPath, 'docs')).toEqual({ ok: false, reason: 'failed' })
    expect(await extractMember(zipPath, 'nope.txt')).toEqual({ ok: false, reason: 'failed' })
  })
})

describe('password-protected archives', () => {
  // Authored with 7-Zip: crypto.zip is classic ZipCrypto (password letmein),
  // aes.zip is AES-256 - adm-zip can only decrypt the former.
  const crypto = join(__dirname, 'fixtures', 'crypto.zip')
  const aes = join(__dirname, 'fixtures', 'aes.zip')

  it('lists encrypted members with the flag', () => {
    const [e] = listArchive(crypto)
    expect(e.name).toBe('secret.txt')
    expect(e.encrypted).toBe(true)
  })
  it('asks for a password, refuses a wrong one, opens with the right one', async () => {
    expect(await extractMember(crypto, 'secret.txt')).toEqual({ ok: false, reason: 'password' })
    expect(await extractMember(crypto, 'secret.txt', 'nope')).toEqual({
      ok: false,
      reason: 'password'
    })
    const r = await extractMember(crypto, 'secret.txt', 'letmein')
    if (!r.ok) throw new Error('expected ok')
    expect(readFileSync(r.path, 'utf8')).toBe('top secret')
  })
  it('opens AES through the system 7-Zip, or names it honestly without one', async () => {
    // The password question comes first either way.
    expect(await extractMember(aes, 'secret.txt')).toEqual({ ok: false, reason: 'password' })
    if (sevenZipExe()) {
      expect(await extractMember(aes, 'secret.txt', 'nope')).toEqual({
        ok: false,
        reason: 'password'
      })
      const r = await extractMember(aes, 'secret.txt', 'letmein')
      if (!r.ok) throw new Error('expected ok via 7z, got ' + r.reason)
      expect(readFileSync(r.path, 'utf8')).toBe('top secret')
    } else {
      expect(await extractMember(aes, 'secret.txt', 'letmein')).toEqual({
        ok: false,
        reason: 'aes'
      })
    }
  })
})

describe('renameMember', () => {
  it('renames within the same folder and keeps the data', async () => {
    expect(await renameMember(zipPath, 'docs/guide.md', 'manual.md')).toBe('ok')
    const entries = listArchive(zipPath).map((e) => e.path)
    expect(entries).toContain('docs/manual.md')
    expect(entries).not.toContain('docs/guide.md')
    expect((await extractMember(zipPath, 'docs/manual.md')).ok).toBe(true)
  })
  it('refuses a taken name rather than overwriting', async () => {
    expect(await renameMember(zipPath, 'readme.txt', 'readme.txt')).toBe('ok') // no-op
    const zip = new AdmZip(zipPath)
    zip.addFile('docs/manual.md', Buffer.from('x'))
    zip.writeZip(zipPath)
    expect(await renameMember(zipPath, 'docs/guide.md', 'manual.md')).toBe('failed')
  })
  it('refuses names that would escape or break the archive', async () => {
    for (const bad of ['../up.md', 'a/b.md', 'a\\b.md', '', 'x?.md']) {
      expect(await renameMember(zipPath, 'docs/guide.md', bad)).toBe('failed')
    }
  })
  it('needs the password to rewrite an encrypted member', async () => {
    // Rename rewrites the container, which stores the member decrypted; a
    // copy is made first so the shared fixture is never mutated.
    const copy = join(mkdtempSync(join(tmpdir(), 'prism-crypto-')), 'c.zip')
    writeFileSync(copy, readFileSync(join(__dirname, 'fixtures', 'crypto.zip')))
    expect(await renameMember(copy, 'secret.txt', 'renamed.txt')).toBe('password')
    expect(await renameMember(copy, 'secret.txt', 'renamed.txt', 'letmein')).toBe('ok')
    expect(listArchive(copy).map((e) => e.path)).toContain('renamed.txt')
  })
})

describe('deleteMember', () => {
  it('removes the member for good', () => {
    expect(deleteMember(zipPath, 'readme.txt')).toBe(true)
    expect(listArchive(zipPath).map((e) => e.path)).not.toContain('readme.txt')
  })
  it('takes a folder and its whole subtree', () => {
    expect(deleteMember(zipPath, 'docs')).toBe(true)
    expect(listArchive(zipPath).map((e) => e.path)).toEqual(['readme.txt'])
  })

  it('says no when there is nothing under that name', () => {
    expect(deleteMember(zipPath, 'nope')).toBe(false)
  })
})

describe('validMemberName', () => {
  it('accepts plain filenames and refuses separators and reserved characters', () => {
    expect(validMemberName('photo (2).jpg')).toBe(true)
    for (const bad of ['a/b', 'a\\b', 'a:b', '..', '.', '', 'a*b', 'a|b']) {
      expect(validMemberName(bad)).toBe(false)
    }
  })
})

describe('drag and drop (#70)', () => {
  it('adds real files and whole folders into the zip, under a folder', async () => {
    const src = mkdtempSync(join(tmpdir(), 'prism-add-'))
    writeFileSync(join(src, 'new.txt'), 'fresh')
    const r = await addToArchive(zipPath, [join(src, 'new.txt')], 'docs')
    if (r === 'encrypted' || r === 'failed') throw new Error('expected a result')
    expect(r.added.map((a) => a.entry)).toEqual(['docs/new.txt'])
    expect(r.clashes).toEqual([])
    expect(listArchive(zipPath).map((e) => e.path)).toContain('docs/new.txt')
    const back = await extractMember(zipPath, 'docs/new.txt')
    if (!back.ok) throw new Error('expected ok')
    expect(readFileSync(back.path, 'utf8')).toBe('fresh')
  })

  it('reports a taken name and writes nothing, unless told to keep both', async () => {
    const src = mkdtempSync(join(tmpdir(), 'prism-add2-'))
    writeFileSync(join(src, 'readme.txt'), 'other')
    expect(await addToArchive(zipPath, [join(src, 'readme.txt')], '')).toMatchObject({
      added: [],
      clashes: ['readme.txt']
    })
    expect(await extractMemberText(zipPath, 'readme.txt')).toBe('hello')
    const kept = await addToArchive(zipPath, [join(src, 'readme.txt')], '', true)
    if (kept === 'encrypted' || kept === 'failed') throw new Error('expected a result')
    expect(kept.added.map((a) => a.entry)).toEqual(['readme (2).txt'])
    expect(listArchive(zipPath).map((e) => e.path)).toContain('readme (2).txt')
  })

  it('reports a source that is not there as failed, and adds the rest', async () => {
    const src = mkdtempSync(join(tmpdir(), 'prism-add3-'))
    writeFileSync(join(src, 'here.txt'), 'here')
    const r = await addToArchive(zipPath, [join(src, 'gone.txt'), join(src, 'here.txt')], '')
    if (r === 'encrypted' || r === 'failed') throw new Error('expected a result')
    expect(r.failed).toEqual([join(src, 'gone.txt')])
    expect(r.added.map((a) => a.entry)).toEqual(['here.txt'])
    expect(deleteMember(zipPath, 'here.txt')).toBe(true)
  })

  it('moves a member into another folder inside the zip, and names the pair', () => {
    expect(moveMembers(zipPath, ['readme.txt'], 'docs')).toEqual({
      moved: [{ from: 'readme.txt', to: 'docs/readme.txt' }],
      clashes: []
    })
    const paths = listArchive(zipPath).map((e) => e.path)
    expect(paths).toContain('docs/readme.txt')
    expect(paths).not.toContain('readme.txt')
  })

  it('moves a folder whole, keeping its shape', () => {
    expect(moveMembers(zipPath, ['docs/img'], '')).toEqual({
      moved: [{ from: 'docs/img', to: 'img' }],
      clashes: []
    })
    const paths = listArchive(zipPath).map((e) => e.path)
    expect(paths).toContain('img/logo.png')
    expect(paths).not.toContain('docs/img/logo.png')
  })

  // #70 D7 (owner approved the spec "as recommended", 2026-11-01): a taken
  // name asks Keep both, the add's question, instead of a bare refusal.
  it('reports a taken name as a clash and writes nothing', () => {
    const zip = new AdmZip(zipPath)
    zip.addFile('docs/readme.txt', Buffer.from('already here'))
    zip.writeZip(zipPath)
    expect(moveMembers(zipPath, ['readme.txt'], 'docs')).toEqual({ moved: [], clashes: ['readme.txt'] })
    expect(listArchive(zipPath).map((e) => e.path)).toContain('readme.txt')
  })

  it('a folder whose name is taken clashes too', () => {
    const zip = new AdmZip(zipPath)
    zip.addFile('other/img/x.png', Buffer.from([1]))
    zip.writeZip(zipPath)
    expect(moveMembers(zipPath, ['other/img'], 'docs')).toEqual({ moved: [], clashes: ['img'] })
  })

  it('Keep both lands a taken name as "name (2)"', () => {
    const zip = new AdmZip(zipPath)
    zip.addFile('docs/readme.txt', Buffer.from('already here'))
    zip.addFile('docs/readme (2).txt', Buffer.from('and this'))
    zip.writeZip(zipPath)
    expect(moveMembers(zipPath, ['readme.txt'], 'docs', true)).toEqual({
      moved: [{ from: 'readme.txt', to: 'docs/readme (3).txt' }],
      clashes: []
    })
    const paths = listArchive(zipPath).map((e) => e.path)
    expect(paths).toContain('docs/readme (3).txt')
    expect(paths).toContain('docs/readme.txt')
  })

  it('lands each member under the name it is given (an undo puts the old name back)', () => {
    expect(moveMembers(zipPath, ['docs/img'], '', false, ['pictures'])).toEqual({
      moved: [{ from: 'docs/img', to: 'pictures' }],
      clashes: []
    })
    expect(listArchive(zipPath).map((e) => e.path)).toContain('pictures/logo.png')
  })

  it('does nothing for members already where they are', () => {
    expect(moveMembers(zipPath, ['docs/guide.md'], 'docs')).toEqual({ moved: [], clashes: [] })
  })

  it('carries the packed size and the time of each member, for the columns', () => {
    const one = listArchive(zipPath).find((e) => e.path === 'readme.txt')!
    expect(one.packed).toBeGreaterThan(0)
    expect(one.mtime).toBeGreaterThan(Date.parse('2020-01-01'))
  })

  it('refuses to rebuild a password-protected archive', async () => {
    const crypto = join(__dirname, 'fixtures', 'crypto.zip')
    const copy = join(mkdtempSync(join(tmpdir(), 'prism-enc-')), 'c.zip')
    writeFileSync(copy, readFileSync(crypto))
    const src = mkdtempSync(join(tmpdir(), 'prism-enc-src-'))
    writeFileSync(join(src, 'x.txt'), 'x')
    expect(hasEncrypted(copy)).toBe(true)
    expect(await addToArchive(copy, [join(src, 'x.txt')], '')).toBe('encrypted')
    expect(moveMembers(copy, ['secret.txt'], 'sub')).toBe('encrypted')
  })
})

/** Small helper: a member's text, for the clash assertions above. */
async function extractMemberText(zip: string, entry: string): Promise<string> {
  const r = await extractMember(zip, entry)
  return r.ok ? readFileSync(r.path, 'utf8') : ''
}

describe('runZipJob (the worker protocol)', () => {
  it('answers a job by name with its result', async () => {
    const r = await runZipJob({
      id: 7,
      op: 'deleteMember',
      args: [zipPath, 'readme.txt'],
      seven: null
    })
    expect(r).toEqual({ id: 7, ok: true, result: true })
  })
  it('sends back the message the code threw, unchanged', async () => {
    const missing = join(mkdtempSync(join(tmpdir(), 'prism-nozip-')), 'gone.zip')
    let thrown = ''
    try {
      listArchive(missing)
    } catch (e) {
      thrown = (e as Error).message
    }
    expect(thrown).not.toBe('')
    expect(await runZipJob({ id: 1, op: 'listArchive', args: [missing], seven: null })).toEqual({
      id: 1,
      ok: false,
      error: thrown
    })
  })
  it('refuses a job it does not know', async () => {
    const r = await runZipJob({ id: 2, op: 'rmrf' as never, args: [], seven: null })
    expect(r).toMatchObject({ id: 2, ok: false, error: expect.stringMatching(/unknown zip op/) })
  })
})
