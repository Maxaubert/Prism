import AdmZip from 'adm-zip'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, join } from 'path'

// The simple archive integration (2026-08-22, #68): zip only, via adm-zip.
// Listing, viewing (extract one member to temp), renaming, deleting and
// copying members - a quick look inside, not WinRAR. adm-zip holds the whole
// container in memory to rewrite it, so operations refuse absurdly large
// archives instead of freezing the window.

/** Past this, listing still works but member operations are refused. */
const MAX_ARCHIVE_BYTES = 600 * 1024 * 1024

export type ArchiveEntry = {
  /** Forward-slash path inside the archive, folders ending with none. */
  path: string
  name: string
  dir: boolean
  size: number
}

/** A member name is a plain filename: no separators, no traversal, not empty. */
export function validMemberName(name: string): boolean {
  return name.length > 0 && name.length <= 200 && !/[\\/:*?"<>|]/.test(name) && name !== '.' && name !== '..'
}

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')

/** Every entry, folders included (some zips omit folder records, so folders
 *  are also derived from member paths). Sorted folders-first per level by the
 *  renderer; this just reports. */
export function listArchive(zipPath: string): ArchiveEntry[] {
  const zip = new AdmZip(zipPath)
  const seen = new Map<string, ArchiveEntry>()
  for (const e of zip.getEntries()) {
    const p = norm(e.entryName)
    if (!p || p.includes('../')) continue // hostile traversal names are not listed
    if (e.isDirectory) {
      if (!seen.has(p)) seen.set(p, { path: p, name: basename(p), dir: true, size: 0 })
    } else {
      seen.set(p, { path: p, name: basename(p), dir: false, size: e.header.size })
    }
    // Parents implied by the path, for zips that never wrote folder records.
    for (let i = p.indexOf('/'); i > 0; i = p.indexOf('/', i + 1)) {
      const parent = p.slice(0, i)
      if (!seen.has(parent)) seen.set(parent, { path: parent, name: basename(parent), dir: true, size: 0 })
    }
  }
  return [...seen.values()]
}

/** Extract one member to a fresh temp dir; returns the extracted path. */
export function extractMember(zipPath: string, entryPath: string): string | null {
  const zip = new AdmZip(zipPath)
  const entry = zip.getEntry(norm(entryPath)) ?? zip.getEntry(norm(entryPath) + '/')
  if (!entry || entry.isDirectory) return null
  const data = entry.getData()
  // The member's own basename, so the viewer's kind detection reads it; the
  // random temp dir keeps two same-named members from colliding.
  const out = join(mkdtempSync(join(tmpdir(), 'prism-zip-')), basename(norm(entryPath)))
  writeFileSync(out, data)
  return out
}

/** Rename one FILE member in place (same folder, new name). */
export function renameMember(zipPath: string, entryPath: string, newName: string): boolean {
  if (!validMemberName(newName)) return false
  const p = norm(entryPath)
  const zip = new AdmZip(zipPath)
  const entry = zip.getEntry(p)
  if (!entry || entry.isDirectory) return false
  const folder = p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : ''
  const target = folder + newName
  if (target === p) return true
  if (zip.getEntry(target)) return false // a taken name refuses, never overwrites
  const data = entry.getData()
  zip.deleteFile(p)
  zip.addFile(target, data)
  zip.writeZip(zipPath)
  return true
}

/** Delete one FILE member. Permanent: there is no recycle bin inside a zip,
 *  which is why the renderer confirms before calling this. */
export function deleteMember(zipPath: string, entryPath: string): boolean {
  const p = norm(entryPath)
  const zip = new AdmZip(zipPath)
  const entry = zip.getEntry(p)
  if (!entry || entry.isDirectory) return false
  zip.deleteFile(p)
  zip.writeZip(zipPath)
  return true
}

export function archiveTooLarge(sizeBytes: number): boolean {
  return sizeBytes > MAX_ARCHIVE_BYTES
}
