import AdmZip from 'adm-zip'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import { uniqueName } from './fileOps'

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
  // A FOLDER (or a folder that exists only as a prefix of its members) takes
  // its whole subtree with it. Undo of a folder dragged INTO a zip needs this,
  // and so does the archive view's own Delete on a folder row.
  if (!entry || entry.isDirectory) {
    const under = zip.getEntries().filter((e) => norm(e.entryName).startsWith(p + '/'))
    if (!under.length) return false
    for (const e of under) zip.deleteFile(e.entryName)
    if (entry) zip.deleteFile(entry.entryName)
    zip.writeZip(zipPath)
    return true
  }
  zip.deleteFile(p)
  zip.writeZip(zipPath)
  return true
}

export function archiveTooLarge(sizeBytes: number): boolean {
  return sizeBytes > MAX_ARCHIVE_BYTES
}

/** What the Properties dialog says about an archive: what it holds, how hard
 *  it squeezed, and whether it is locked. */
export type ArchiveStat = {
  files: number
  folders: number
  /** Bytes the members take once unpacked. */
  uncompressed: number
  encryption: 'none' | 'zipcrypto' | 'aes'
}

export function archiveStat(zipPath: string): ArchiveStat | null {
  try {
    const zip = new AdmZip(zipPath)
    const folders = new Set<string>()
    let files = 0
    let uncompressed = 0
    let encryption: ArchiveStat['encryption'] = 'none'
    for (const e of zip.getEntries()) {
      const p = norm(e.entryName)
      if (!p) continue
      for (let i = p.indexOf('/'); i > 0; i = p.indexOf('/', i + 1)) folders.add(p.slice(0, i))
      if (e.isDirectory) {
        folders.add(p)
        continue
      }
      files += 1
      uncompressed += e.header.size
      if (e.header.method === AES_METHOD) encryption = 'aes'
      else if ((e.header.flags & 1) === 1 && encryption === 'none') encryption = 'zipcrypto'
    }
    return { files, folders: folders.size, uncompressed, encryption }
  } catch {
    return null
  }
}

/* ---------- drag and drop (#70): add, move within, extract out ---------- */

/** True when any member is password protected. Rewriting such a container with
 *  adm-zip would re-emit those entries wrongly, so the write verbs that rebuild
 *  it (add, move) refuse rather than quietly corrupting the archive. */
export function hasEncrypted(zipPath: string): boolean {
  return new AdmZip(zipPath).getEntries().some((e) => (e.header.flags & 1) === 1)
}

const joinIn = (folder: string, name: string): string => (folder ? `${norm(folder)}/${name}` : name)

export type AddResult =
  | { added: Array<{ src: string; entry: string }>; clashes: string[]; failed: string[] }
  | 'encrypted'
  | 'failed'

/**
 * Put real files and folders INTO the zip, under `destFolder` ('' is the root).
 * Folders go in whole. A taken name comes back as a clash and nothing is
 * written, unless `keepBoth` renames the arrivals instead.
 */
export function addToArchive(
  zipPath: string,
  srcPaths: readonly string[],
  destFolder: string,
  keepBoth = false
): AddResult {
  try {
    if (hasEncrypted(zipPath)) return 'encrypted'
    const zip = new AdmZip(zipPath)
    const taken = new Set(zip.getEntries().map((e) => norm(e.entryName).toLowerCase()))
    const clashes: string[] = []
    const failed: string[] = []
    const jobs: Array<{ src: string; name: string; dir: boolean }> = []
    const zipAt = resolve(zipPath)
    for (const src of srcPaths) {
      if (!existsSync(src)) {
        failed.push(src)
        continue
      }
      // The archive cannot contain itself: dropping a zip (or a folder holding
      // it) onto its own view would rewrite the file mid-read and then bin it.
      const at = resolve(src)
      if (at === zipAt || !relative(at, zipAt).startsWith('..')) {
        failed.push(src)
        continue
      }
      const name = basename(src)
      const dir = statSync(src).isDirectory()
      if (taken.has(joinIn(destFolder, name).toLowerCase())) {
        if (!keepBoth) {
          clashes.push(name)
          continue
        }
        // "name (2)" inside the zip, the way the folder verbs spell it.
        const ext = dir ? '' : (/\.[^.]*$/.exec(name)?.[0] ?? '')
        const stem = ext ? name.slice(0, -ext.length) : name
        let n = 2
        let candidate = `${stem} (${n})${ext}`
        while (taken.has(joinIn(destFolder, candidate).toLowerCase()) && n < 1000) {
          n += 1
          candidate = `${stem} (${n})${ext}`
        }
        jobs.push({ src, name: candidate, dir })
        taken.add(joinIn(destFolder, candidate).toLowerCase())
      } else {
        jobs.push({ src, name, dir })
        taken.add(joinIn(destFolder, name).toLowerCase())
      }
    }
    if (clashes.length && !keepBoth) return { added: [], clashes, failed }
    const added: Array<{ src: string; entry: string }> = []
    for (const j of jobs) {
      try {
        const before = zip.getEntries().length
        if (j.dir) zip.addLocalFolder(j.src, joinIn(destFolder, j.name))
        else zip.addLocalFile(j.src, norm(destFolder), j.name)
        // An EMPTY folder writes nothing at all: counting it as added would
        // have the caller bin the original for a member that is not there.
        if (zip.getEntries().length <= before) failed.push(j.src)
        else added.push({ src: j.src, entry: joinIn(destFolder, j.name) })
      } catch {
        failed.push(j.src)
      }
    }
    if (added.length) zip.writeZip(zipPath)
    return { added, clashes, failed }
  } catch {
    return 'failed'
  }
}

/** Move members to another folder INSIDE the same zip; folders move whole. */
export function moveMembers(
  zipPath: string,
  entryPaths: readonly string[],
  destFolder: string
): 'ok' | 'encrypted' | 'failed' {
  try {
    if (hasEncrypted(zipPath)) return 'encrypted'
    const zip = new AdmZip(zipPath)
    const dest = norm(destFolder)
    // Dropping a folder on itself (or inside its own subtree) would nest its
    // contents one level deeper every time; there is nothing to do instead.
    const wanted = entryPaths.map(norm).filter((w) => dest !== w && !dest.startsWith(w + '/'))
    const moves: Array<{ from: string; to: string; data: Buffer }> = []
    for (const e of zip.getEntries()) {
      if (e.isDirectory) continue
      const p = norm(e.entryName)
      for (const w of wanted) {
        // The dragged member itself, or anything beneath a dragged folder.
        const under = p === w || p.startsWith(w + '/')
        if (!under) continue
        const parent = w.includes('/') ? w.slice(0, w.lastIndexOf('/')) : ''
        const rel = parent ? p.slice(parent.length + 1) : p
        const to = dest ? `${dest}/${rel}` : rel
        if (to !== p) moves.push({ from: p, to, data: e.getData() })
        break
      }
    }
    if (!moves.length) return 'ok'
    // A move onto a taken name is refused whole: an archive is not the place to
    // discover half a move happened.
    const existing = new Set(zip.getEntries().map((e) => norm(e.entryName).toLowerCase()))
    if (moves.some((m) => existing.has(m.to.toLowerCase()))) return 'failed'
    for (const m of moves) {
      zip.deleteFile(m.from)
      zip.addFile(m.to, m.data)
    }
    zip.writeZip(zipPath)
    return 'ok'
  } catch {
    return 'failed'
  }
}

/**
 * Extract members OUT to a real folder, keeping the shape below a dragged
 * folder. Encrypted members need the password, exactly as viewing one does.
 */
export function extractTo(
  zipPath: string,
  entryPaths: readonly string[],
  destDir: string,
  password?: string
): { ok: true; written: number } | { ok: false; reason: MemberFail } {
  try {
    if (!existsSync(destDir)) return { ok: false, reason: 'failed' }
    const base = resolve(destDir)
    const zip = new AdmZip(zipPath)
    const wanted = entryPaths.map(norm)
    let written = 0
    for (const e of zip.getEntries()) {
      if (e.isDirectory) continue
      const p = norm(e.entryName)
      const hit = wanted.find((w) => p === w || p.startsWith(w + '/'))
      if (hit === undefined) continue
      const parent = hit.includes('/') ? hit.slice(0, hit.lastIndexOf('/')) : ''
      const rel = parent ? p.slice(parent.length + 1) : p
      // Zip Slip: a member can be named anything at all, so the only safe test
      // is where the write would actually LAND. Absolute names, drive letters
      // and any ".." that survives resolution are dropped, not sanitised.
      if (!rel || isAbsolute(rel) || /^[a-z]:/i.test(rel)) continue
      let target = resolve(base, ...rel.split('/'))
      const inside = relative(base, target)
      if (!inside || inside.startsWith('..') || inside.split(sep).includes('..') || isAbsolute(inside))
        continue
      // Never overwrite what is already there: an extraction is a copy out,
      // and a member sharing a name with the user's own file must not destroy
      // it. "name (2)" is the same answer the folder verbs give.
      if (existsSync(target)) {
        const dir = dirname(target)
        mkdirSync(dir, { recursive: true })
        target = join(dir, uniqueName(dir, basename(target)))
      }
      const like = e as unknown as ZipEntryLike
      let data: Buffer
      if (like.header.method === AES_METHOD) {
        if (!password) return { ok: false, reason: 'password' }
        const r = sevenExtract(zipPath, p, password)
        if (!r.ok) return { ok: false, reason: r.reason }
        data = readFileSync(r.path)
      } else {
        try {
          data = like.getData(password)
          if (!data?.length && e.header.size > 0) throw new Error('no data')
        } catch {
          return { ok: false, reason: failOf(like, !!password) }
        }
      }
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, data)
      written += 1
    }
    return { ok: true, written }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}
