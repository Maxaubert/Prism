import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { basename, dirname, join, resolve, relative, sep } from 'path'
import type { ArchiveEntry, MemberFail } from './archive'

/**
 * Archives that are not zip: 7z, rar, tar, gz, bz2, xz, iso, cab.
 *
 * zip stays with adm-zip because Prism WRITES zips (rename, delete, add, move
 * inside the container). These are read-only, which is the honest limit: rar
 * cannot be written by anything free, and the rest are not worth a second
 * write path. The panel says so rather than offering verbs that would fail.
 *
 * Everything here goes through the bundled 7-Zip binary (tools/fetch-7zip.mjs),
 * which reads all of these formats itself - one code path instead of a tar
 * parser, a gzip path and a 7z path that each need their own bugs found.
 */

/** Extensions this module owns. zip is deliberately absent. */
const SEVEN_EXTS = new Set(['.7z', '.rar', '.tar', '.gz', '.tgz', '.bz2', '.tbz', '.xz', '.txz', '.iso', '.cab'])

export function isSevenArchive(ext: string): boolean {
  return SEVEN_EXTS.has(ext.toLowerCase())
}

export const sevenExtensions = (): string[] => [...SEVEN_EXTS]

/** Where the bundled 7-Zip lives; the same walk-up rule as ffmpeg. */
export function sevenDirs(packaged: boolean, resourcesPath: string, appPath: string): string[] {
  const dirs: string[] = []
  if (packaged) dirs.push(join(resourcesPath, 'bin'))
  let up = appPath
  for (let i = 0; i < 4; i++) {
    dirs.push(join(up, 'vendor', '7zip'))
    const parent = dirname(up)
    if (parent === up) break
    up = parent
  }
  return dirs
}

let cached: string | null | undefined

export function bundledSeven(packaged: boolean, resourcesPath: string, appPath: string): string | null {
  if (cached !== undefined) return cached
  cached = sevenDirs(packaged, resourcesPath, appPath).map((d) => join(d, '7z.exe')).find(existsSync) ?? null
  return cached
}

/** Test seam. */
export function resetSeven(): void {
  cached = undefined
}

/**
 * Parse `7z l -slt` output into entries.
 *
 * -slt prints one block per member as `Key = value` lines, which is the only
 * listing format that survives names containing spaces, dashes and newlines
 * in a way we can read back.
 */
export function parseListing(out: string): ArchiveEntry[] {
  const entries: ArchiveEntry[] = []
  // Everything before the first "----------" is the archive's own header.
  const body = out.includes('----------') ? out.slice(out.indexOf('----------') + 10) : out
  for (const block of body.split(/\r?\n\r?\n/)) {
    const get = (key: string): string | null => {
      const m = new RegExp('^' + key + ' = (.*)$', 'm').exec(block)
      return m ? m[1].trim() : null
    }
    const path = get('Path')
    if (!path) continue
    const attr = get('Attributes') ?? ''
    const folder = (get('Folder') ?? '').toLowerCase() === '+' || /^D/.test(attr)
    const size = Number(get('Size') ?? '0')
    const enc = (get('Encrypted') ?? '').toLowerCase() === '+'
    const norm = path.replace(/\\/g, '/')
    entries.push({
      // No trailing slash on folders: that is Prism's convention (see
      // ArchiveEntry), and the panel's parentOf() puts a folder inside itself
      // when one is left on.
      path: norm.replace(/\/+$/, ''),
      name: basename(norm),
      dir: folder,
      size: Number.isFinite(size) ? size : 0,
      ...(enc ? { encrypted: true } : {})
    })
  }
  return entries
}

/** argv for listing. Switches first, then `--`, so no member name is a switch. */
export function listArgs(file: string, password: string): string[] {
  return ['l', '-slt', '-y', `-p${password}`, '--', file]
}

/** argv for extracting one member, keeping its folders, into `dir`. */
export function extractArgs(file: string, entry: string, dir: string, password: string): string[] {
  return ['x', `-o${dir}`, '-y', `-p${password}`, '--', file, entry]
}

/** List an archive 7-Zip understands. null when it could not be read. */
export function listSeven(exe: string, file: string, password = ''): ArchiveEntry[] | null {
  try {
    const out = execFileSync(exe, listArgs(file, password), {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60000,
      maxBuffer: 64 << 20
    })
    return parseListing(out)
  } catch {
    return null
  }
}

/**
 * Extract one member to a fresh temp folder, returning the file's path.
 *
 * The extracted path is checked to be inside the temp folder before it is
 * handed back: an archive is untrusted input, and a member called
 * `..\..\Startup\evil.exe` is a real thing that exists.
 */
export function extractSeven(
  exe: string,
  file: string,
  entryPath: string,
  password = ''
): { ok: true; path: string } | { ok: false; reason: MemberFail } {
  const dir = mkdtempSync(join(tmpdir(), 'prism-arc-'))
  try {
    execFileSync(exe, extractArgs(file, entryPath, dir, password), {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
      timeout: 120000
    })
  } catch (err) {
    const stderr = String((err as { stderr?: Buffer }).stderr ?? '')
    return { ok: false, reason: /wrong password|cannot open encrypted/i.test(stderr) ? 'password' : 'failed' }
  }
  const out = join(dir, entryPath.replace(/\//g, sep))
  const rel = relative(resolve(dir), resolve(out))
  if (rel.startsWith('..') || (rel.includes(':') && rel !== '')) return { ok: false, reason: 'failed' }
  return existsSync(out) ? { ok: true, path: out } : { ok: false, reason: 'failed' }
}
