import AdmZip from 'adm-zip'
import { execFile } from './spawnWorker'
import { existsSync } from 'fs'
import { mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { exists } from './fsUtil'
import type { ExtractFail } from '@shared/extraction'
import type { ArchiveAddResult, ArchiveStat } from '@shared/ipcTypes'

// What the zip worker (zipOps.ts) and main's own zip code (archive.ts) share
// (owner, 2026-10-12, zip work off the main process): the types, the member
// name rules, and the AES route through 7-Zip. Pure of Electron, so it loads
// in the utility process and in vitest alike.

export type ArchiveEntry = {
  /** Forward-slash path inside the archive, folders ending with none. */
  path: string
  name: string
  dir: boolean
  size: number
  /** What the member actually occupies inside the container. Folders have
   *  none, and a stored (uncompressed) member has the same as `size`. */
  packed?: number
  /** The entry's own modified time, epoch ms. Every container carries one;
   *  it is the archive's copy of it, not the file on disk's. */
  mtime?: number
  /** Password-protected. ZipCrypto opens with the password; AES cannot. */
  encrypted?: boolean
}

/** Why a member operation could not deliver: it wants a password (missing or
 *  wrong), the entry is AES-encrypted (adm-zip only decrypts ZipCrypto), or
 *  something else broke. The extraction's own reasons, by another name. */
export type MemberFail = ExtractFail
export type { ArchiveStat }
export type AddResult = ArchiveAddResult

export const AES_METHOD = 99

export type ZipEntryLike = {
  header: { size: number; flags: number; method: number; crc: number }
  isDirectory: boolean
  getData: (pass?: string) => Buffer
  getCompressedData: () => Buffer
}

export const failOf = (e: ZipEntryLike, hasPassword: boolean): MemberFail => {
  if (e.header.method === AES_METHOD) return 'aes'
  return (e.header.flags & 1) === 1 || hasPassword ? 'password' : 'failed'
}

export const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')

/** A member name is a plain filename: no separators, no traversal, not empty. */
export function validMemberName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 200 &&
    !/[\\/:*?"<>|]/.test(name) &&
    name !== '.' &&
    name !== '..'
  )
}

/**
 * The names a move inside a zip lands its members under (#70 D8: an undo
 * puts the old names back). Undefined when none are sent; null REFUSES the
 * move (#70 review, 2026-11-01): a list that is not one good name per member
 * used to be dropped, moving under the old names while the undo reported
 * success for a different result.
 */
export function moveNames(names: unknown, count: number): string[] | null | undefined {
  if (names === undefined || names === null) return undefined
  if (!Array.isArray(names) || names.length !== count) return null
  return names.every((n) => typeof n === 'string' && validMemberName(n)) ? (names as string[]) : null
}

// AES-encrypted zips (7-Zip's and WinRAR's default) are beyond adm-zip, so
// they go through 7-Zip - args-only execFile against a fixed path, the same
// enumerated-exe rule the "Open in" menu holds to.
//
// The BUNDLED 7-Zip is the one to use (2026-08-30). This looked only in
// Program Files and then told the user to install a tool Prism has been
// shipping in resources/bin since 2026-08-24, so the commonest encrypted zip
// there is (AES-256 is what 7-Zip and WinRAR both write by default) was
// refused on a machine that could open it perfectly well. main injects the
// bundled path at startup; the installed copies stay as a fallback for a
// process that never injected one - the unit tests, and a dev run with no
// vendor dir fetched yet. The zip worker is handed main's answer with every
// job (zipClient.ts), so both processes use the same 7-Zip.
const SEVEN_ZIP_PATHS = [
  'C:\\Program Files\\7-Zip\\7z.exe',
  'C:\\Program Files (x86)\\7-Zip\\7z.exe'
]
let sevenCache: string | null | undefined
let injected: string | null = null

const probeInstalled = (): string | null =>
  // sync-ok: startup (setSevenExe), the zip worker, or a process that never called it (the unit tests); cached
  SEVEN_ZIP_PATHS.find((p) => existsSync(p)) ?? null

/** Point the AES path at the 7-Zip Prism ships. Called once, from main, at
 *  startup: with none bundled, the installed copies are looked for HERE, so
 *  the first AES member opened later is not a stat on main's thread. */
export function setSevenExe(exe: string | null): void {
  injected = exe
  if (!exe && sevenCache === undefined) sevenCache = probeInstalled()
}

export function sevenZipExe(): string | null {
  if (injected) return injected
  if (sevenCache === undefined) sevenCache = probeInstalled()
  return sevenCache
}

/** Extract one member with 7z into a fresh temp dir, or into `into` (the run's
 *  member folder, #300) when given. */
export async function sevenExtract(
  zipPath: string,
  entryPath: string,
  password: string,
  into?: string
): Promise<{ ok: true; path: string } | { ok: false; reason: MemberFail }> {
  const exe = sevenZipExe()
  if (!exe) return { ok: false, reason: 'aes' }
  const dir = into ?? (await mkdtemp(join(tmpdir(), 'prism-zip-')))
  // Switches first, then `--` so a member named "-something" inside a hostile
  // zip can never be read as a 7z switch. Async, because execFileSync stopped
  // the whole main process while 7-Zip worked (2026-08-26).
  const failed = await new Promise<string | null>((resolve) => {
    execFile(
      exe,
      ['e', `-o${dir}`, `-p${password}`, '-y', '--', zipPath, norm(entryPath)],
      { windowsHide: true, timeout: 30000, encoding: 'utf8' },
      (err, _out, stderr) => resolve(err ? String(stderr ?? '') : null)
    )
  })
  if (failed !== null) {
    return { ok: false, reason: /wrong password/i.test(failed) ? 'password' : 'failed' }
  }
  const out = join(dir, basename(norm(entryPath)))
  return (await exists(out)) ? { ok: true, path: out } : { ok: false, reason: 'failed' }
}

/** Every entry of an open zip, folders included (some zips omit folder
 *  records, so folders are also derived from member paths). */
export function listZip(zip: AdmZip): ArchiveEntry[] {
  const seen = new Map<string, ArchiveEntry>()
  for (const e of zip.getEntries()) {
    const p = norm(e.entryName)
    if (!p || p.includes('../')) continue // hostile traversal names are not listed
    if (e.isDirectory) {
      if (!seen.has(p)) seen.set(p, { path: p, name: basename(p), dir: true, size: 0 })
    } else {
      const when = e.header.time instanceof Date ? e.header.time.getTime() : NaN
      seen.set(p, {
        path: p,
        name: basename(p),
        dir: false,
        size: e.header.size,
        packed: e.header.compressedSize,
        ...(Number.isFinite(when) && when > 0 ? { mtime: when } : {}),
        encrypted: (e.header.flags & 1) === 1 || undefined
      })
    }
    // Parents implied by the path, for zips that never wrote folder records.
    for (let i = p.indexOf('/'); i > 0; i = p.indexOf('/', i + 1)) {
      const parent = p.slice(0, i)
      if (!seen.has(parent))
        seen.set(parent, { path: parent, name: basename(parent), dir: true, size: 0 })
    }
  }
  return [...seen.values()]
}
