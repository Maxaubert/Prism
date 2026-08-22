import AdmZip from 'adm-zip'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it } from 'vitest'
import { deleteMember, extractMember, listArchive, renameMember, validMemberName } from './archive'

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
  it('writes the member to temp under its own name', () => {
    const r = extractMember(zipPath, 'docs/guide.md')
    if (!r.ok) throw new Error('expected ok')
    expect(r.path).toMatch(/guide\.md$/)
    expect(readFileSync(r.path, 'utf8')).toBe('# guide')
  })
  it('refuses folders and unknown members', () => {
    expect(extractMember(zipPath, 'docs')).toEqual({ ok: false, reason: 'failed' })
    expect(extractMember(zipPath, 'nope.txt')).toEqual({ ok: false, reason: 'failed' })
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
  it('asks for a password, refuses a wrong one, opens with the right one', () => {
    expect(extractMember(crypto, 'secret.txt')).toEqual({ ok: false, reason: 'password' })
    expect(extractMember(crypto, 'secret.txt', 'nope')).toEqual({ ok: false, reason: 'password' })
    const r = extractMember(crypto, 'secret.txt', 'letmein')
    if (!r.ok) throw new Error('expected ok')
    expect(readFileSync(r.path, 'utf8')).toBe('top secret')
  })
  it('names AES as the reason it cannot open', () => {
    expect(extractMember(aes, 'secret.txt', 'letmein')).toEqual({ ok: false, reason: 'aes' })
  })
})

describe('renameMember', () => {
  it('renames within the same folder and keeps the data', () => {
    expect(renameMember(zipPath, 'docs/guide.md', 'manual.md')).toBe('ok')
    const entries = listArchive(zipPath).map((e) => e.path)
    expect(entries).toContain('docs/manual.md')
    expect(entries).not.toContain('docs/guide.md')
    expect(extractMember(zipPath, 'docs/manual.md').ok).toBe(true)
  })
  it('refuses a taken name rather than overwriting', () => {
    expect(renameMember(zipPath, 'readme.txt', 'readme.txt')).toBe('ok') // no-op
    const zip = new AdmZip(zipPath)
    zip.addFile('docs/manual.md', Buffer.from('x'))
    zip.writeZip(zipPath)
    expect(renameMember(zipPath, 'docs/guide.md', 'manual.md')).toBe('failed')
  })
  it('refuses names that would escape or break the archive', () => {
    for (const bad of ['../up.md', 'a/b.md', 'a\\b.md', '', 'x?.md']) {
      expect(renameMember(zipPath, 'docs/guide.md', bad)).toBe('failed')
    }
  })
  it('needs the password to rewrite an encrypted member', () => {
    // Rename rewrites the container, which stores the member decrypted; a
    // copy is made first so the shared fixture is never mutated.
    const copy = join(mkdtempSync(join(tmpdir(), 'prism-crypto-')), 'c.zip')
    writeFileSync(copy, readFileSync(join(__dirname, 'fixtures', 'crypto.zip')))
    expect(renameMember(copy, 'secret.txt', 'renamed.txt')).toBe('password')
    expect(renameMember(copy, 'secret.txt', 'renamed.txt', 'letmein')).toBe('ok')
    expect(listArchive(copy).map((e) => e.path)).toContain('renamed.txt')
  })
})

describe('deleteMember', () => {
  it('removes the member for good', () => {
    expect(deleteMember(zipPath, 'readme.txt')).toBe(true)
    expect(listArchive(zipPath).map((e) => e.path)).not.toContain('readme.txt')
  })
  it('refuses folders', () => {
    expect(deleteMember(zipPath, 'docs')).toBe(false)
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
