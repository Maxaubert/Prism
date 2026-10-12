import AdmZip from 'adm-zip'
import { mkdtemp, readFile, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join, relative, resolve } from 'path'
import {
  AES_METHOD,
  failOf,
  listZip,
  norm,
  setSevenExe,
  sevenExtract,
  validMemberName,
  type AddResult,
  type ArchiveEntry,
  type ArchiveStat,
  type MemberFail,
  type ZipEntryLike
} from './zipShared'

// The simple archive integration (2026-08-22, #68): zip only, via adm-zip.
// Listing, viewing (extract one member to temp), renaming, deleting and
// copying members - a quick look inside, not WinRAR. adm-zip holds the whole
// container in memory to rewrite it, so main refuses absurdly large archives
// (archive.ts, `archiveTooLarge`) before asking for any of this.
//
// THIS FILE RUNS IN THE ZIP WORKER, NEVER ON MAIN (owner, 2026-10-12, "zip
// editing off the main process"). adm-zip reads and writes whole archives
// synchronously, which used to freeze the window for as long as a 600MB
// rewrite took. zipWorker.ts imports it in a utility process; main reaches it
// only through archive.ts's client. Pure of Electron, so vitest calls it
// directly. Every adm-zip call below is synchronous by design and is fine
// HERE because this thread owns no window.

/** Every entry, folders included. Sorted folders-first per level by the
 *  renderer; this just reports. */
export function listArchive(zipPath: string): ArchiveEntry[] {
  // sync-ok: adm-zip, in the zip worker (zipWorker.ts), never on main
  return listZip(new AdmZip(zipPath))
}

/** Extract one member to a fresh temp dir. */
export async function extractMember(
  zipPath: string,
  entryPath: string,
  password?: string
): Promise<{ ok: true; path: string } | { ok: false; reason: MemberFail }> {
  // sync-ok: adm-zip, in the zip worker (zipWorker.ts), never on main
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
  const out = join(await mkdtemp(join(tmpdir(), 'prism-zip-')), basename(norm(entryPath)))
  await writeFile(out, data)
  return { ok: true, path: out }
}

/** Rename one FILE member in place (same folder, new name). Rewriting stores
 *  the member decrypted, so an encrypted one needs its password here too. */
export async function renameMember(
  zipPath: string,
  entryPath: string,
  newName: string,
  password?: string
): Promise<'ok' | MemberFail> {
  if (!validMemberName(newName)) return 'failed'
  const p = norm(entryPath)
  // sync-ok: adm-zip, in the zip worker (zipWorker.ts), never on main
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
    const r = await sevenExtract(zipPath, p, password)
    if (!r.ok) return r.reason
    data = await readFile(r.path)
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
  // sync-ok: adm-zip, in the zip worker (zipWorker.ts), never on main
  zip.writeZip(zipPath)
  return 'ok'
}

/** Delete one FILE member. Permanent: there is no recycle bin inside a zip,
 *  which is why the renderer confirms before calling this. */
export function deleteMember(zipPath: string, entryPath: string): boolean {
  const p = norm(entryPath)
  // sync-ok: adm-zip, in the zip worker (zipWorker.ts), never on main
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
    // sync-ok: adm-zip, in the zip worker (zipWorker.ts), never on main
    zip.writeZip(zipPath)
    return true
  }
  zip.deleteFile(p)
  // sync-ok: adm-zip, in the zip worker (zipWorker.ts), never on main
  zip.writeZip(zipPath)
  return true
}

export function archiveStat(zipPath: string): ArchiveStat | null {
  try {
    // sync-ok: adm-zip, in the zip worker (zipWorker.ts), never on main
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

/* ---------- drag and drop (#70): add, move within ---------- */

/** True when any member is password protected. Rewriting such a container with
 *  adm-zip would re-emit those entries wrongly, so the write verbs that rebuild
 *  it (add, move) refuse rather than quietly corrupting the archive. */
export function hasEncrypted(zipPath: string): boolean {
  // sync-ok: adm-zip, in the zip worker (zipWorker.ts), never on main
  return encryptedIn(new AdmZip(zipPath))
}

/** `hasEncrypted` for a zip already open: add and move read the container
 *  ONCE and ask this, where they used to read it twice. */
function encryptedIn(zip: AdmZip): boolean {
  return zip.getEntries().some((e) => (e.header.flags & 1) === 1)
}

const joinIn = (folder: string, name: string): string => (folder ? `${norm(folder)}/${name}` : name)

/**
 * Put real files and folders INTO the zip, under `destFolder` ('' is the root).
 * Folders go in whole. A taken name comes back as a clash and nothing is
 * written, unless `keepBoth` renames the arrivals instead. The clashes are
 * all found before anything is added.
 */
export async function addToArchive(
  zipPath: string,
  srcPaths: readonly string[],
  destFolder: string,
  keepBoth = false
): Promise<AddResult> {
  try {
    // sync-ok: adm-zip, in the zip worker (zipWorker.ts), never on main
    const zip = new AdmZip(zipPath)
    if (encryptedIn(zip)) return 'encrypted'
    const taken = new Set(zip.getEntries().map((e) => norm(e.entryName).toLowerCase()))
    const clashes: string[] = []
    const failed: string[] = []
    const jobs: Array<{ src: string; name: string; dir: boolean }> = []
    const zipAt = resolve(zipPath)
    for (const src of srcPaths) {
      const st = await stat(src).catch(() => null)
      if (!st) {
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
      const dir = st.isDirectory()
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
        // sync-ok: adm-zip, in the zip worker (zipWorker.ts), never on main
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
    // sync-ok: adm-zip, in the zip worker (zipWorker.ts), never on main
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
    // sync-ok: adm-zip, in the zip worker (zipWorker.ts), never on main
    const zip = new AdmZip(zipPath)
    if (encryptedIn(zip)) return 'encrypted'
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
    // sync-ok: adm-zip, in the zip worker (zipWorker.ts), never on main
    zip.writeZip(zipPath)
    return 'ok'
  } catch {
    return 'failed'
  }
}

/* ---------- the worker's protocol ---------- */

/** Every job the worker runs, by name. main posts the name and the arguments;
 *  the types travel to the client (zipClient.ts) as `import type` only, so
 *  adm-zip is never loaded on main. */
export const ZIP_OPS = {
  listArchive,
  extractMember,
  renameMember,
  deleteMember,
  archiveStat,
  hasEncrypted,
  addToArchive,
  moveMembers
}

export type ZipOps = typeof ZIP_OPS
export type ZipOp = keyof ZipOps

export interface ZipRequest {
  id: number
  op: ZipOp
  args: unknown[]
  /** main's 7-Zip (zipShared.ts `sevenZipExe`), for the AES route. */
  seven: string | null
}

export type ZipReply =
  { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string }

/** One job, answered. An error comes back as the SAME message the code threw,
 *  so main's callers see what they always saw. */
export async function runZipJob(req: ZipRequest): Promise<ZipReply> {
  try {
    const fn = ZIP_OPS[req.op] as ((...a: unknown[]) => unknown) | undefined
    if (typeof fn !== 'function') throw new Error(`unknown zip op: ${String(req.op)}`)
    setSevenExe(req.seven)
    return { id: req.id, ok: true, result: await fn(...req.args) }
  } catch (err) {
    return { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
