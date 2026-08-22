import AdmZip from 'adm-zip'
import { mkdtempSync, readFileSync } from 'fs'
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
    const out = extractMember(zipPath, 'docs/guide.md')
    expect(out).toMatch(/guide\.md$/)
    expect(readFileSync(out!, 'utf8')).toBe('# guide')
  })
  it('refuses folders and unknown members', () => {
    expect(extractMember(zipPath, 'docs')).toBeNull()
    expect(extractMember(zipPath, 'nope.txt')).toBeNull()
  })
})

describe('renameMember', () => {
  it('renames within the same folder and keeps the data', () => {
    expect(renameMember(zipPath, 'docs/guide.md', 'manual.md')).toBe(true)
    const entries = listArchive(zipPath).map((e) => e.path)
    expect(entries).toContain('docs/manual.md')
    expect(entries).not.toContain('docs/guide.md')
    expect(extractMember(zipPath, 'docs/manual.md')).toBeTruthy()
  })
  it('refuses a taken name rather than overwriting', () => {
    expect(renameMember(zipPath, 'readme.txt', 'readme.txt')).toBe(true) // no-op
    const zip = new AdmZip(zipPath)
    zip.addFile('docs/manual.md', Buffer.from('x'))
    zip.writeZip(zipPath)
    expect(renameMember(zipPath, 'docs/guide.md', 'manual.md')).toBe(false)
  })
  it('refuses names that would escape or break the archive', () => {
    for (const bad of ['../up.md', 'a/b.md', 'a\\b.md', '', 'x?.md']) {
      expect(renameMember(zipPath, 'docs/guide.md', bad)).toBe(false)
    }
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
