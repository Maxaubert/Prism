import AdmZip from 'adm-zip'
import { readFile, writeFile } from 'fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import { crc32, inflateRaw } from 'zlib'
import { Made } from './extractJob'
import { uniqueNameAsync } from './fileOps'
import { createZipClient, type ZipClient, type ZipProc } from './zipClient'
import {
  AES_METHOD,
  failOf,
  listZip,
  norm,
  sevenExtract,
  sevenZipExe,
  validMemberName,
  type AddResult,
  type ArchiveEntry,
  type ArchiveStat,
  type MemberFail,
  type ZipEntryLike
} from './zipShared'
import { exists } from './fsUtil'
import { ZIP_WRITE_MAX } from '@shared/archiveLimits'
import type { ArchiveEncryption, ArchiveMoveResult } from '@shared/ipcTypes'

export { setSevenExe, sevenZipExe, validMemberName } from './zipShared'
export type { AddResult, ArchiveEntry, ArchiveStat, MemberFail } from './zipShared'

// The simple archive integration (2026-08-22, #68): zip only, via adm-zip.
// Listing, viewing (extract one member to temp), renaming, deleting and
// copying members - a quick look inside, not WinRAR. adm-zip holds the whole
// container in memory to rewrite it, so operations refuse absurdly large
// archives instead of freezing the window.
//
// MAIN'S SIDE ONLY (owner, 2026-10-12, "zip editing off the main process").
// Every verb that hands adm-zip a PATH (list, extract one, rename, delete,
// stat, add, move) runs in the zip worker (zipWorker.ts, logic in zipOps.ts)
// and is a thin async call here. What stays is what already never waited:
// the Explorer's listing and member unpacking, and the extraction out, which
// read the container with fs/promises and inflate on the libuv pool. Those
// wait for any edit of the same zip asked for before them.

let client: ZipClient | null = null

/** How main starts the zip worker: `utilityProcess.fork` of zipWorker.js,
 *  handed over at startup (index.ts) so this file never imports Electron and
 *  its tests can run the worker's code in-process. */
export function setZipFork(fork: () => ZipProc, idleMs?: number): void {
  client?.stop()
  client = createZipClient({ fork, seven: sevenZipExe, idleMs })
}

function zip(): ZipClient {
  if (!client) throw new Error('zip worker not started')
  return client
}

/** Every entry, folders included (some zips omit folder records, so folders
 *  are also derived from member paths). Sorted folders-first per level by the
 *  renderer; this just reports. */
export function listArchive(zipPath: string): Promise<ArchiveEntry[]> {
  return zip().read('listArchive', zipPath)
}

/** Extract one member to a fresh temp dir. */
export function extractMember(
  zipPath: string,
  entryPath: string,
  password?: string
): Promise<{ ok: true; path: string } | { ok: false; reason: MemberFail }> {
  return zip().read('extractMember', zipPath, entryPath, password)
}

/** Rename one FILE member in place (same folder, new name). Rewriting stores
 *  the member decrypted, so an encrypted one needs its password here too. */
export function renameMember(
  zipPath: string,
  entryPath: string,
  newName: string,
  password?: string
): Promise<'ok' | MemberFail> {
  if (!validMemberName(newName)) return Promise.resolve('failed')
  return zip().edit('renameMember', zipPath, entryPath, newName, password)
}

/** Delete one member, or a folder and its subtree. Permanent: there is no
 *  recycle bin inside a zip, which is why the renderer confirms first. */
export function deleteMember(zipPath: string, entryPath: string): Promise<boolean> {
  return zip().edit('deleteMember', zipPath, entryPath)
}

export function archiveTooLarge(sizeBytes: number): boolean {
  return sizeBytes > ZIP_WRITE_MAX
}

export function archiveStat(zipPath: string): Promise<ArchiveStat | null> {
  return zip().read('archiveStat', zipPath)
}

/** True when any member is password protected (add and move refuse those). */
export function hasEncrypted(zipPath: string): Promise<boolean> {
  return zip().read('hasEncrypted', zipPath)
}

/** Put real files and folders INTO the zip, under `destFolder` ('' is the
 *  root). A taken name comes back as a clash and nothing is written, unless
 *  `keepBoth` renames the arrivals instead. */
export function addToArchive(
  zipPath: string,
  srcPaths: readonly string[],
  destFolder: string,
  keepBoth = false
): Promise<AddResult> {
  return zip().edit('addToArchive', zipPath, [...srcPaths], destFolder, keepBoth)
}

/** Move members to another folder INSIDE the same zip; folders move whole. */
export function moveMembers(
  zipPath: string,
  entryPaths: readonly string[],
  destFolder: string
): Promise<ArchiveMoveResult> {
  return zip().edit('moveMembers', zipPath, [...entryPaths], destFolder)
}

/** Resolves once every edit of `zipPath` asked for so far has settled (no
 *  worker started yet means there is none). adm-zip's writeZip is not atomic,
 *  so a reader on main (the Explorer's listing, a member unpacked, an
 *  extraction out) waits here rather than parse a half-written container. */
export const editsSettled = (zipPath: string): Promise<void> =>
  client?.settled(zipPath) ?? Promise.resolve()

/**
 * A zip's entries and how it is locked, from bytes already read (#300). The
 * Explorer lists a zip from a Buffer read with `fs/promises`, the shape
 * `extractTo` uses: `new AdmZip(path)` is a readFileSync of the whole
 * container on main's one thread.
 */
export function listZipData(data: Buffer): {
  entries: ArchiveEntry[]
  encryption: ArchiveEncryption
} {
  const zip = new AdmZip(data)
  let encryption: ArchiveEncryption = 'none'
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue
    if (e.header.method === AES_METHOD) encryption = 'aes'
    else if ((e.header.flags & 1) === 1 && encryption === 'none') encryption = 'zipcrypto'
  }
  return { entries: listZip(zip), encryption }
}

/**
 * One member out to `destDir` for VIEWING it (#300, the member temp folder).
 * Asynchronous all the way: the container is read with `fs/promises` and a
 * deflated member is inflated on the libuv pool (`memberData`), so arrowing
 * through a zip never stops main. The member's own basename, so the viewer's
 * kind detection reads it. AES goes through 7-Zip, as everywhere else.
 */
export async function unpackMember(
  zipPath: string,
  entryPath: string,
  destDir: string,
  password?: string
): Promise<{ ok: true; path: string } | { ok: false; reason: MemberFail }> {
  try {
    await editsSettled(zipPath)
    const zip = new AdmZip(await readFile(zipPath))
    const entry = zip.getEntry(norm(entryPath))
    if (!entry || entry.isDirectory) return { ok: false, reason: 'failed' }
    const like = entry as unknown as ZipEntryLike
    if (like.header.method === AES_METHOD) {
      if (!password) return { ok: false, reason: 'password' }
      return sevenExtract(zipPath, entryPath, password, destDir)
    }
    let data: Buffer
    try {
      data = await memberData(like, password)
      if (!data?.length && entry.header.size > 0) throw new Error('no data')
    } catch {
      return { ok: false, reason: failOf(like, !!password) }
    }
    const name = basename(norm(entryPath))
    if (!validMemberName(name)) return { ok: false, reason: 'failed' }
    const out = join(destDir, name)
    await writeFile(out, data)
    return { ok: true, path: out }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}

const DEFLATED = 8

/**
 * One member's bytes, WITHOUT stopping main for the length of the inflate
 * (2026-09-19, #166).
 *
 * `getData` inflates synchronously, and extracting a 500MB zip through it was
 * main's one thread doing nothing else for the whole job: no IPC, so no
 * progress reached the window and no Cancel reached main until it was over.
 * A plain deflated member, which is nearly all of them, is inflated on the
 * libuv pool instead, and checked against the central directory's CRC exactly
 * as adm-zip checks it.
 *
 * NOT adm-zip's own `getDataAsync`, and that was read rather than assumed: its
 * inflater (methods/inflater.js) attaches no 'error' listener to the stream,
 * so one corrupt member is an unhandled 'error' event, which takes the whole
 * app down rather than failing one extraction. A stored member is a buffer
 * copy, and a ZipCrypto one has to be decrypted by adm-zip's own (synchronous)
 * code first, so both of those stay with `getData`.
 */
function memberData(e: ZipEntryLike, password?: string): Promise<Buffer> {
  const plain = (e.header.flags & 1) === 0
  if (!plain || e.header.method !== DEFLATED) return Promise.resolve(e.getData(password))
  return new Promise((done, fail) => {
    // The cap is what the container itself declared, so a member that lies
    // about its size cannot inflate without limit.
    const opts = e.header.size > 0 ? { maxOutputLength: e.header.size } : {}
    inflateRaw(e.getCompressedData(), opts, (err, data) => {
      if (err) return fail(err)
      if (crc32(data) !== e.header.crc >>> 0) return fail(new Error('bad crc'))
      done(data)
    })
  })
}

/** Who is watching an in-process extraction: the window's progress, and the
 *  question the loop asks between members. */
export interface ExtractWatch {
  /** `done` of `total` files are written; `file` is the one just finished. */
  onProgress?: (pct: number, file: string) => void
  cancelled?: () => boolean
}

/**
 * Extract members OUT to a real folder, keeping the shape below a dragged
 * folder. Encrypted members need the password, exactly as viewing one does.
 *
 * ASYNCHRONOUS AND CANCELLABLE (2026-09-19, #166). The container is read with
 * `fs/promises`, each member is inflated off main's thread and written with
 * an awaited `writeFile`, so the event loop turns between every member: that
 * is what lets a progress message out and a Cancel in. Progress is a COUNT of
 * members written against the count wanted, which is as real as it gets for
 * an engine with no percentage of its own.
 *
 * A Cancel takes back exactly what this call made (`Made`): the files it
 * wrote, each under a name that was free, and the folders it created, which
 * go only if they are empty afterwards. Nothing that was in the destination
 * before is touched. A FAILURE keeps what had already been written, as it
 * always has: those files are good, and the user asked for them.
 */
export async function extractTo(
  zipPath: string,
  entryPaths: readonly string[],
  destDir: string,
  password?: string,
  watch?: ExtractWatch
): Promise<{ ok: true; written: number } | { ok: false; reason: MemberFail | 'cancelled' }> {
  const made = new Made()
  try {
    if (!(await exists(destDir))) return { ok: false, reason: 'failed' }
    const base = resolve(destDir)
    await editsSettled(zipPath)
    // A Buffer, read without blocking: `new AdmZip(path)` is a readFileSync
    // of up to the 600MB cap.
    const zip = new AdmZip(await readFile(zipPath))
    const wanted = entryPaths.map(norm)
    const hitOf = (p: string): string | undefined =>
      wanted.find((w) => p === w || p.startsWith(w + '/'))
    const members = zip.getEntries().filter((e) => !e.isDirectory && hitOf(norm(e.entryName)) !== undefined)
    let written = 0
    for (const e of members) {
      if (watch?.cancelled?.()) {
        await made.undo()
        return { ok: false, reason: 'cancelled' }
      }
      const p = norm(e.entryName)
      const hit = hitOf(p) as string
      const parent = hit.includes('/') ? hit.slice(0, hit.lastIndexOf('/')) : ''
      const rel = parent ? p.slice(parent.length + 1) : p
      // Zip Slip: a member can be named anything at all, so the only safe test
      // is where the write would actually LAND. Absolute names, drive letters
      // and any ".." that survives resolution are dropped, not sanitised.
      if (!rel || isAbsolute(rel) || /^[a-z]:/i.test(rel)) continue
      let target = resolve(base, ...rel.split('/'))
      const inside = relative(base, target)
      if (
        !inside ||
        inside.startsWith('..') ||
        inside.split(sep).includes('..') ||
        isAbsolute(inside)
      )
        continue
      // Never overwrite what is already there: an extraction is a copy out,
      // and a member sharing a name with the user's own file must not destroy
      // it. "name (2)" is the same answer the folder verbs give.
      if (await exists(target)) {
        const dir = dirname(target)
        target = join(dir, await uniqueNameAsync(dir, basename(target)))
      }
      const like = e as unknown as ZipEntryLike
      let data: Buffer
      if (like.header.method === AES_METHOD) {
        if (!password) return { ok: false, reason: 'password' }
        const r = await sevenExtract(zipPath, p, password)
        if (!r.ok) return { ok: false, reason: r.reason }
        data = await readFile(r.path)
      } else {
        try {
          data = await memberData(like, password)
          if (!data?.length && e.header.size > 0) throw new Error('no data')
        } catch {
          return { ok: false, reason: failOf(like, !!password) }
        }
      }
      // The folder is made HERE, once there are bytes to put in it, and not
      // before the member is read: a member that cannot be read (a missing or
      // wrong password, every time) would otherwise leave an empty folder in
      // a destination of the user's own choosing. The free-name test above
      // does not need it, since a name can only be taken in a folder that
      // already exists.
      await made.mkdir(dirname(target))
      // Recorded BEFORE the write: a file that a Cancel finds half written
      // is still one this call created.
      made.file(target)
      await writeFile(target, data)
      written += 1
      watch?.onProgress?.(Math.floor((written / members.length) * 100), p)
    }
    if (watch?.cancelled?.()) {
      await made.undo()
      return { ok: false, reason: 'cancelled' }
    }
    return { ok: true, written }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}
