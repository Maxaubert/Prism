import { execFile, spawn } from 'child_process'

/**
 * Every 7-Zip call is ASYNC (2026-08-26), and that is not a style preference.
 * execFileSync blocks the WHOLE main process: every window, every IPC reply,
 * the terminals, and the fsmedia:// Range handler a playing video depends on.
 * Extracting a 115MB archive measured 278ms of that; the verb allows ten
 * minutes, so a big archive froze the app for as long as it took.
 */
function run(
  exe: string,
  args: string[],
  timeout: number
): Promise<{ ok: true; out: string } | { ok: false; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      exe,
      args,
      { encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 64 << 20 },
      (err, stdout, stderr) =>
        resolve(err ? { ok: false, stderr: String(stderr ?? '') } : { ok: true, out: stdout })
    )
  })
}
import { existsSync, mkdirSync, mkdtempSync } from 'fs'
import { copyFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import type { ArchiveEntry, MemberFail } from './archive'
import { uniqueName } from './fileOps'

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
const SEVEN_EXTS = new Set([
  '.7z',
  '.rar',
  '.tar',
  '.gz',
  '.tgz',
  '.bz2',
  '.tbz',
  '.xz',
  '.txz',
  '.iso',
  '.cab'
])

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

export function bundledSeven(
  packaged: boolean,
  resourcesPath: string,
  appPath: string
): string | null {
  if (cached !== undefined) return cached
  cached =
    sevenDirs(packaged, resourcesPath, appPath)
      .map((d) => join(d, '7z.exe'))
      .find(existsSync) ?? null
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
export function parseListing(out: string, archiveName = 'file'): ArchiveEntry[] {
  const entries: ArchiveEntry[] = []
  // Everything before the first "----------" is the archive's own header.
  const body = out.includes('----------') ? out.slice(out.indexOf('----------') + 10) : out
  for (const block of body.split(/\r?\n\r?\n/)) {
    const get = (key: string): string | null => {
      const m = new RegExp('^' + key + ' = (.*)$', 'm').exec(block)
      return m ? m[1].trim() : null
    }
    // A single-stream container (.xz, .gz, .bz2) lists its one member with no
    // Path at all: 7-Zip names it after the archive, and so do we - otherwise
    // the panel shows an empty archive that plainly is not empty.
    const size0 = get('Size')
    const path =
      get('Path') ??
      (size0 !== null ? archiveName.replace(/\.(xz|gz|bz2|tgz|tbz|txz)$/i, '') : null)
    if (!path) continue
    const attr = get('Attributes') ?? ''
    const folder = (get('Folder') ?? '').toLowerCase() === '+' || /^D/.test(attr)
    const size = Number(get('Size') ?? '0')
    const packed = Number(get('Packed Size') ?? '')
    // "2026-07-04 17:14:30", 7-Zip's own format, in local time.
    const when = Date.parse((get('Modified') ?? '').replace(' ', 'T'))
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
      ...(Number.isFinite(packed) ? { packed } : {}),
      ...(Number.isFinite(when) ? { mtime: when } : {}),
      ...(enc ? { encrypted: true } : {})
    })
  }
  return entries
}

/** argv for listing. Switches first, then `--`, so no member name is a switch. */
export function listArgs(file: string, password: string): string[] {
  return ['l', '-slt', '-y', `-p${password}`, '--', file]
}

/** argv for extracting the WHOLE archive into `dir`, folders and all. */
export function extractAllArgs(file: string, dir: string, password: string): string[] {
  // `-p` with nothing after it is not "no password", it is an EMPTY one, and
  // on an archive with encrypted members that is a wrong answer rather than
  // no answer. Omitted entirely when there is none.
  return ['x', `-o${dir}`, '-y', ...(password ? [`-p${password}`] : []), '--', file]
}

/**
 * The switches that make 7-Zip report progress at all.
 *
 * MEASURED, because the obvious one is not enough: with `-bsp1` alone and
 * stdout redirected, 7-Zip prints NOTHING between "Extracting archive" and
 * "Everything is Ok" - the progress indicator is suppressed when the output
 * is not a console. Adding `-bb1` (log the name of each file) brings both the
 * names AND the percentages back, so it is the pair that works, not either.
 */
export const PROGRESS_ARGS = ['-bb1', '-bsp1']

/** How many "- name" lines are in this chunk: with `-bb1` 7-Zip logs one per
 *  file, so counting them is a percentage even when no % ever appears. */
export function countFiles(chunk: string): number {
  return (chunk.match(/(^|[\r\n])\s*(\d{1,3}%\s+)?- /g) ?? []).length
}

/** The percentage out of a 7-Zip progress line, or null. `-bsp1` writes them
 *  to stdout as " 42% 17 - some/file.jpg", carriage-returned over each other. */
export function readPercent(chunk: string): number | null {
  let last: number | null = null
  for (const m of chunk.matchAll(/(\d{1,3})%/g)) {
    const n = Number(m[1])
    if (n >= 0 && n <= 100) last = n
  }
  return last
}

/**
 * The same extraction, reporting how far along it is.
 *
 * A 2GB archive takes minutes, and a button that says "Extracting..." for
 * minutes is indistinguishable from one that has hung. `-bsp1` puts 7-Zip's
 * own percentage on stdout, so this spawns rather than execFile's buffer-it-
 * all, and streams.
 */
function runWithProgress(
  exe: string,
  args: string[],
  onPercent: (pct: number) => void,
  total = 0
): Promise<{ ok: true } | { ok: false; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { windowsHide: true })
    let err = ''
    let out = ''
    let done = 0
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d: string) => {
      // 7-Zip writes its errors to STDOUT as often as to stderr, so the tail
      // of both is kept: a failure that says only "failed" is a failure
      // nobody can act on.
      out = (out + d).slice(-4000)
      const pct = readPercent(d)
      if (pct !== null) {
        onPercent(pct)
        return
      }
      // No percentage in this chunk: fall back to counting files done, which
      // is the only signal on an archive whose members are few and huge.
      done += countFiles(d)
      if (total > 0 && done > 0) onPercent(Math.min(99, Math.floor((done / total) * 100)))
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (d: string) => {
      err = (err + d).slice(-4000)
    })
    child.on('error', () => resolve({ ok: false, stderr: 'could not start 7-Zip' }))
    child.on('close', (code) => {
      // 1 is 7-Zip's WARNING code: some files were skipped, the rest came out.
      // Treating it as failure threw away a working extraction.
      if (code === 0 || code === 1) resolve({ ok: true })
      else resolve({ ok: false, stderr: (err + '\n' + out).trim() })
    })
  })
}

/** argv for extracting one member, keeping its folders, into `dir`. */
export function extractArgs(file: string, entry: string, dir: string, password: string): string[] {
  return ['x', `-o${dir}`, '-y', `-p${password}`, '--', file, entry]
}

/**
 * List an archive 7-Zip understands.
 *
 * Says WHY it failed (2026-08-30). A 7z or rar written with "encrypt file
 * names" cannot even be listed without the password, and this used to answer
 * a flat null, which the panel rendered as "this archive looks corrupt" - so
 * a perfectly good archive read as broken and there was nowhere to type the
 * password it was asking for. Same test as the member paths use.
 */
export async function listSeven(
  exe: string,
  file: string,
  password = ''
): Promise<{ ok: true; entries: ArchiveEntry[] } | { ok: false; reason: MemberFail }> {
  const r = await run(exe, listArgs(file, password), 60000)
  if (r.ok) return { ok: true, entries: parseListing(r.out, basename(file)) }
  return {
    ok: false,
    reason: /wrong password|cannot open encrypted/i.test(r.stderr) ? 'password' : 'failed'
  }
}

/**
 * Is this member name safe to hand to an extractor?
 *
 * An archive is untrusted input, and a member called `..\..\Startup\evil.exe`
 * is a real thing that exists. This is checked BEFORE 7-Zip is spawned:
 * checking afterwards only tells you where the file was SUPPOSED to land,
 * by which point anything that escaped is already written.
 */
export function safeMemberPath(entryPath: string, dir: string): string | null {
  if (!entryPath || entryPath.length > 4096) return null
  const norm = entryPath.replace(/\\/g, '/')
  if (norm.startsWith('/') || /^[a-z]:/i.test(norm)) return null // absolute
  if (norm.split('/').some((seg) => seg === '..')) return null // traversal
  if (norm.includes(String.fromCharCode(0))) return null
  const target = resolve(dir, norm.replace(/\//g, sep))
  const rel = relative(resolve(dir), target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  return norm
}

/**
 * Extract one member to a fresh temp folder, returning the file's path.
 *
 * The name is refused before 7-Zip runs, and the result is checked again
 * afterwards: the first stops an escape happening, the second catches an
 * extractor that rewrote the path on its own.
 */
/**
 * Extract EVERYTHING into `dir`. 7-Zip does the walking, so member names never
 * pass through here one by one - but `-o` is still handed a directory Prism
 * made itself, and 7-Zip's own extraction refuses to write outside it.
 */
export async function extractAllSeven(
  exe: string,
  file: string,
  dir: string,
  password = '',
  onPercent?: (pct: number) => void,
  total = 0
): Promise<{ ok: true } | { ok: false; reason: MemberFail; message?: string }> {
  const args = extractAllArgs(file, dir, password)
  const r = onPercent
    ? await runWithProgress(exe, [...PROGRESS_ARGS, ...args], onPercent, total)
    : await run(exe, args, 3600000)
  if (r.ok) return { ok: true }
  return {
    ok: false,
    reason: /wrong password|cannot open encrypted/i.test(r.stderr) ? 'password' : 'failed',
    // The line 7-Zip actually printed, so a failure can be acted on rather
    // than only noticed.
    message: sevenMessage(r.stderr)
  }
}

/** The most useful line out of 7-Zip's noise, for showing to a person. */
export function sevenMessage(raw: string): string {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const named =
    lines.find((l) => /^ERROR/i.test(l)) ??
    lines.find((l) => /(cannot|denied|space|corrupt|unsupported|unavailable)/i.test(l))
  return (named ?? lines[lines.length - 1] ?? '').slice(0, 300)
}

export async function extractSeven(
  exe: string,
  file: string,
  entryPath: string,
  password = ''
): Promise<{ ok: true; path: string } | { ok: false; reason: MemberFail }> {
  const dir = mkdtempSync(join(tmpdir(), 'prism-arc-'))
  const safe = safeMemberPath(entryPath, dir)
  if (!safe) return { ok: false, reason: 'failed' }
  const r = await run(exe, extractArgs(file, safe, dir, password), 120000)
  if (!r.ok) {
    return {
      ok: false,
      reason: /wrong password|cannot open encrypted/i.test(r.stderr) ? 'password' : 'failed'
    }
  }
  const out = join(dir, safe.replace(/\//g, sep))
  const rel = relative(resolve(dir), resolve(out))
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return { ok: false, reason: 'failed' }
  return existsSync(out) ? { ok: true, path: out } : { ok: false, reason: 'failed' }
}

/**
 * Extract members OUT to a real folder from a 7z/rar/iso/tar (2026-08-28).
 *
 * The zip path (archive.ts extractTo) reads entries with adm-zip, which knows
 * nothing about these containers - so dragging a member out of a .7z onto a
 * folder always answered "failed", with no reason to show. The landing rules
 * are the zip path's, deliberately: the dragged folder's parent is stripped so
 * the shape below it is kept, a name that would land outside destDir is
 * dropped rather than sanitised, and an existing file is never overwritten -
 * it lands as "name (2)", the answer every other Prism verb gives.
 */
export async function extractSevenTo(
  exe: string,
  file: string,
  entryPaths: readonly string[],
  destDir: string,
  password = ''
): Promise<{ ok: true; written: number } | { ok: false; reason: MemberFail }> {
  if (!existsSync(destDir)) return { ok: false, reason: 'failed' }
  const listed = await listSeven(exe, file, password)
  if (!listed.ok) return { ok: false, reason: listed.reason }
  const listing = listed.entries
  const clean = (e: string): string => e.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const wanted = entryPaths.map(clean)
  const base = resolve(destDir)
  let written = 0
  for (const entry of listing) {
    if (entry.dir) continue
    const p = clean(entry.path)
    const hit = wanted.find((w) => p === w || p.startsWith(w + '/'))
    if (hit === undefined) continue
    const parent = hit.includes('/') ? hit.slice(0, hit.lastIndexOf('/')) : ''
    const rel = parent ? p.slice(parent.length + 1) : p
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
    const got = await extractSeven(exe, file, p, password)
    if (!got.ok) return { ok: false, reason: got.reason }
    const dir = dirname(target)
    mkdirSync(dir, { recursive: true })
    if (existsSync(target)) target = join(dir, uniqueName(dir, basename(target)))
    // AWAITED, and the temp copy goes with it: main is one thread, and a 2GB
    // member copied with copyFileSync freezes every window and the Range
    // handler a playing film depends on. extractSeven makes a fresh temp dir
    // per member and nothing else ever removes them (2026-08-28).
    await copyFile(got.path, target)
    await rm(dirname(got.path), { recursive: true, force: true }).catch(() => {})
    written += 1
  }
  return { ok: true, written }
}
