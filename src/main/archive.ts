import AdmZip from 'adm-zip'
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
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
  /** Password-protected. ZipCrypto opens with the password; AES cannot. */
  encrypted?: boolean
}

/** Why a member operation could not deliver: it wants a password (missing or
 *  wrong), the entry is AES-encrypted (adm-zip only decrypts ZipCrypto), or
 *  something else broke. */
export type MemberFail = 'password' | 'aes' | 'failed'

const AES_METHOD = 99

const failOf = (e: ZipEntryLike, hasPassword: boolean): MemberFail => {
  if (e.header.method === AES_METHOD) return 'aes'
  return (e.header.flags & 1) === 1 || hasPassword ? 'password' : 'failed'
}

// AES-encrypted zips (7-Zip's and WinRAR's default) are beyond adm-zip, so
// they go through the system's own 7-Zip when it is installed - args-only
// execFile against a fixed detected path, the same enumerated-exe rule the
// "Open in" menu holds to. Without 7-Zip the answer stays an honest 'aes'.
const SEVEN_ZIP_PATHS = [
  'C:\\Program Files\\7-Zip\\7z.exe',
  'C:\\Program Files (x86)\\7-Zip\\7z.exe'
]
let sevenCache: string | null | undefined
export function sevenZipExe(): string | null {
  if (sevenCache === undefined) sevenCache = SEVEN_ZIP_PATHS.find((p) => existsSync(p)) ?? null
  return sevenCache
}

/** Extract one member with 7z into a fresh temp dir. */
function sevenExtract(
  zipPath: string,
  entryPath: string,
  password: string
): { ok: true; path: string } | { ok: false; reason: MemberFail } {
  const exe = sevenZipExe()
  if (!exe) return { ok: false, reason: 'aes' }
  const dir = mkdtempSync(join(tmpdir(), 'prism-zip-'))
  try {
    // Switches first, then `--` so a member named "-something" inside a
    // hostile zip can never be read as a 7z switch.
    execFileSync(exe, ['e', `-o${dir}`, `-p${password}`, '-y', '--', zipPath, norm(entryPath)], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
      timeout: 30000
    })
  } catch (err) {
    const stderr = String((err as { stderr?: Buffer }).stderr ?? '')
    return { ok: false, reason: /wrong password/i.test(stderr) ? 'password' : 'failed' }
  }
  const out = join(dir, basename(norm(entryPath)))
  return existsSync(out) ? { ok: true, path: out } : { ok: false, reason: 'failed' }
}

type ZipEntryLike = {
  header: { size: number; flags: number; method: number }
  isDirectory: boolean
  getData: (pass?: string) => Buffer
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
      seen.set(p, {
        path: p,
        name: basename(p),
        dir: false,
        size: e.header.size,
        encrypted: (e.header.flags & 1) === 1 || undefined
      })
    }
    // Parents implied by the path, for zips that never wrote folder records.
    for (let i = p.indexOf('/'); i > 0; i = p.indexOf('/', i + 1)) {
      const parent = p.slice(0, i)
      if (!seen.has(parent)) seen.set(parent, { path: parent, name: basename(parent), dir: true, size: 0 })
    }
  }
  return [...seen.values()]
}

/** Extract one member to a fresh temp dir. */
export function extractMember(
  zipPath: string,
  entryPath: string,
  password?: string
): { ok: true; path: string } | { ok: false; reason: MemberFail } {
  const zip = new AdmZip(zipPath)
  const entry = zip.getEntry(norm(entryPath)) ?? zip.getEntry(norm(entryPath) + '/')
  if (!entry || entry.isDirectory) return { ok: false, reason: 'failed' }
  const like = entry as unknown as ZipEntryLike
  if (like.header.method === AES_METHOD) {
    // The password question comes first even on the 7z route, so the prompt
    // flow is identical whichever cipher the zip used.
    if (!password) return { ok: false, reason: 'password' }
    return sevenExtract(zipPath, entryPath, password)
  }
  let data: Buffer
  try {
    data = like.getData(password)
    if (!data?.length && entry.header.size > 0) throw new Error('no data')
  } catch {
    return { ok: false, reason: failOf(like, !!password) }
  }
  // The member's own basename, so the viewer's kind detection reads it; the
  // random temp dir keeps two same-named members from colliding.
  const out = join(mkdtempSync(join(tmpdir(), 'prism-zip-')), basename(norm(entryPath)))
  writeFileSync(out, data)
  return { ok: true, path: out }
}

/** Rename one FILE member in place (same folder, new name). Rewriting stores
 *  the member decrypted, so an encrypted one needs its password here too. */
export function renameMember(
  zipPath: string,
  entryPath: string,
  newName: string,
  password?: string
): 'ok' | MemberFail {
  if (!validMemberName(newName)) return 'failed'
  const p = norm(entryPath)
  const zip = new AdmZip(zipPath)
  const entry = zip.getEntry(p)
  if (!entry || entry.isDirectory) return 'failed'
  const folder = p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : ''
  const target = folder + newName
  if (target === p) return 'ok'
  if (zip.getEntry(target)) return 'failed' // a taken name refuses, never overwrites
  const like = entry as unknown as ZipEntryLike
  let data: Buffer
  if (like.header.method === AES_METHOD) {
    if (!password) return 'password'
    const r = sevenExtract(zipPath, p, password)
    if (!r.ok) return r.reason
    data = readFileSync(r.path)
  } else {
    try {
      data = like.getData(password)
      if (!data?.length && entry.header.size > 0) throw new Error('no data')
    } catch {
      return failOf(like, !!password)
    }
  }
  zip.deleteFile(p)
  zip.addFile(target, data)
  zip.writeZip(zipPath)
  return 'ok'
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
