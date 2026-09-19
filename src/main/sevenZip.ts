import { execFile, spawn, type ChildProcess } from 'child_process'

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
    const child = execFile(
      exe,
      args,
      { encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 64 << 20 },
      (err, stdout, stderr) => {
        if (!err) return resolve({ ok: true, out: stdout })
        // Both streams: 7-Zip's password prompt is on STDOUT, and it is what
        // says why a run with no password stopped. The TAIL of stdout, as the
        // progress runner keeps: a listing can be megabytes.
        const said = [String(stderr ?? ''), String(stdout ?? '').slice(-4000)]
        resolve({ ok: false, stderr: said.join('\n').trim() })
      }
    )
    // NOBODY IS GOING TO TYPE (2026-09-20, see `NO_STDIN`).
    child.stdin?.end()
  })
}

/**
 * 7-ZIP ASKS FOR A PASSWORD ON STDIN, AND WAITS FOR EVER (2026-09-20, found
 * reviewing #166, MEASURED on 7-Zip 25.00).
 *
 * A 7z whose CONTENT is encrypted but whose names are not (the common case:
 * "encrypt file names" is an extra tick) lists without a password, so nothing
 * fails early. Extracted with no `-p`, which is how Prism says "no password",
 * 7-Zip creates the first folder, prints "Enter password (will not be
 * echoed):" on stdout and READS STDIN. Node's default stdin for a child is an
 * open pipe nobody writes to, so the process sat there: eight seconds in the
 * probe before it was killed, and an hour in the app, which is the timeout.
 * Before #166 that was a chip that never finished. Under #166 it is a modal
 * window over the whole app with a bar that never moves, and the archive
 * panel's own password question never got asked, because the answer it waits
 * for ('password') never came back.
 *
 * With stdin closed the prompt reads end-of-file and 7-Zip stops at once with
 * "Break signaled", MEASURED, which `sevenFailReason` reads as the password
 * being wanted.
 */
const NO_STDIN: ['ignore', 'pipe', 'pipe'] = ['ignore', 'pipe', 'pipe']

/**
 * Why a 7-Zip run failed, from everything it printed.
 *
 * "Enter password" is the prompt above, which only appears when 7-Zip wanted
 * a password it had not been given. The other two are its words for a wrong
 * one, and for an archive whose names are encrypted as well. The prompt is
 * matched WHOLE, brackets and all: with `-bb1` the same text carries member
 * names, and a member called "enter password.txt" in a run that failed for
 * some other reason must not turn that failure into a password question.
 */
export function sevenFailReason(raw: string): 'password' | 'failed' {
  const wanted = /wrong password|cannot open encrypted|enter password \(will not be echoed\)/i
  return wanted.test(raw) ? 'password' : 'failed'
}
import { existsSync, mkdtempSync } from 'fs'
import { cp, mkdtemp, rename, rm } from 'fs/promises'
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
 *  to stdout as " 42% 17 - some/file.jpg", carriage-returned over each other.
 *
 *  Read only at the START of a line (2026-09-19). MEASURED: the name of each
 *  member arrives on a line of its own ("- in\file 1.bin"), and a member
 *  called "50% off.jpg" was a percentage as far as the old anywhere-match
 *  could tell, which now that the window shows the bar to everyone is a bar
 *  that jumps about. */
export function readPercent(chunk: string): number | null {
  let last: number | null = null
  for (const m of chunk.matchAll(/(?:^|[\r\n])[ \t]*(\d{1,3})%/g)) {
    const n = Number(m[1])
    if (n >= 0 && n <= 100) last = n
  }
  return last
}

/**
 * The member 7-Zip is writing, out of its `-bb1` log, or null.
 *
 * MEASURED on 7-Zip 25.00 with stdout redirected: each member is one line,
 * "- in\sub dir\deep.bin", after the carriage return that wipes the progress
 * indicator, and the archive's own header prints a bare "--" which is not
 * one (there is no space and no name after it). The LAST one in the chunk,
 * since a chunk is often many files. Forward slashes, as Prism names members
 * everywhere else.
 */
export function readFileName(chunk: string): string | null {
  let last: string | null = null
  for (const m of chunk.matchAll(/(?:^|[\r\n])[ \t]*(?:\d{1,3}%[ \t]+(?:\d+[ \t]+)?)?- ([^\r\n]+)/g)) {
    const name = m[1].trim()
    if (name) last = name.replace(/\\/g, '/')
  }
  return last
}

/**
 * Who is watching an extraction (2026-09-19, #166): the window's progress,
 * and the job that has to be able to STOP it.
 */
export interface SevenWatch {
  /** `pct` is null when the chunk carried a name and no percentage, and
   *  `file` is null the other way about. */
  onProgress?: (pct: number | null, file: string | null) => void
  /** How many files are coming, so a count of them is a fraction of
   *  something when 7-Zip prints no percentage at all. */
  total?: number
  /** The process, the moment there is one, so Cancel has something to kill. */
  onChild?: (child: ChildProcess) => void
}

/**
 * The same extraction, reporting how far along it is.
 *
 * A 2GB archive takes minutes, and a window that says nothing for minutes is
 * indistinguishable from one that has hung. `-bsp1` puts 7-Zip's own
 * percentage on stdout, so this spawns rather than execFile's buffer-it-
 * all, and streams.
 */
function runWithProgress(
  exe: string,
  args: string[],
  watch: SevenWatch
): Promise<{ ok: true } | { ok: false; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: NO_STDIN })
    watch.onChild?.(child)
    const total = watch.total ?? 0
    let err = ''
    let out = ''
    let done = 0
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d: string) => {
      // 7-Zip writes its errors to STDOUT as often as to stderr, so the tail
      // of both is kept: a failure that says only "failed" is a failure
      // nobody can act on.
      out = (out + d).slice(-4000)
      const file = readFileName(d)
      done += countFiles(d)
      let pct = readPercent(d)
      // No percentage in this chunk: fall back to counting files done, which
      // is the only signal on an archive whose members are few and huge.
      if (pct === null && total > 0 && done > 0)
        pct = Math.min(99, Math.floor((done / total) * 100))
      if (pct !== null || file !== null) watch.onProgress?.(pct, file)
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
    reason: sevenFailReason(r.stderr)
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
  watch?: SevenWatch
): Promise<{ ok: true } | { ok: false; reason: MemberFail; message?: string }> {
  const args = extractAllArgs(file, dir, password)
  const r = watch
    ? await runWithProgress(exe, [...PROGRESS_ARGS, ...args], watch)
    : await run(exe, args, 3600000)
  if (r.ok) return { ok: true }
  return {
    ok: false,
    reason: sevenFailReason(r.stderr),
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
      reason: sevenFailReason(r.stderr)
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
/**
 * Extract a whole SUBTREE in ONE 7-Zip call.
 *
 * The member-at-a-time route below was fine for the one file an archive
 * preview extracts and catastrophic for a folder: it spawns a process per
 * member, and each one re-opens the container. MEASURED on a 2GB zip - the
 * 25-file "Comic Books" folder came out in 0.41s as a single call against 25
 * spawns each re-reading 2GB, and "Artbooks" holds 561 files. That is what
 * "Extract folder here" was failing on.
 *
 * 7-Zip keeps the member's FULL path under `-o`, so the result lands at
 * `dir/<prefix>` and the caller moves it from there. Both the folder entry
 * and its contents are named, so a folder recorded in the container is
 * created even when it is empty.
 */
export async function extractSevenSubtree(
  exe: string,
  file: string,
  prefix: string,
  dir: string,
  password = '',
  watch?: SevenWatch
): Promise<{ ok: true } | { ok: false; reason: MemberFail; message?: string }> {
  const clean = prefix
    .replace(/[\\/]+$/, '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
  // The name comes out of the archive's own listing, but a container is
  // untrusted input and `-o` is the only thing keeping this inside a folder
  // Prism made. Refused before 7-Zip is spawned, never after.
  if (!clean || clean.split('/').some((s) => s === '..') || /^[a-z]:/i.test(clean)) {
    return { ok: false, reason: 'failed' }
  }
  const args = [
    'x',
    `-o${dir}`,
    '-y',
    ...(password ? [`-p${password}`] : []),
    '--',
    file,
    clean,
    `${clean}/*`
  ]
  const r = watch
    ? await runWithProgress(exe, [...PROGRESS_ARGS, ...args], watch)
    : await run(exe, args, 3600000)
  if (r.ok) return { ok: true }
  return {
    ok: false,
    reason: sevenFailReason(r.stderr),
    message: sevenMessage(r.stderr)
  }
}

/**
 * STAGED IN THE DESTINATION, and landed by RENAME (2026-09-19, #166).
 *
 * This used to stage in the temp directory and `cp` each entry across, which
 * was two problems once the extraction got a Cancel button. A copy of a big
 * folder cannot be stopped half way by anything Node offers, and it is a
 * second full write of data 7-Zip has already written once. Staging inside
 * the destination folder is the rule "Extract folder here" learned on
 * 2026-08-31 (`fs.rename` cannot cross volumes, and temp is on C: while the
 * archive very often is not): the rename is same-volume, so it is instant
 * whatever the folder weighs, and until it happens everything half-written
 * lives in ONE folder that is Prism's own to remove. The staging name starts
 * with a dot, which the tree's listing and its watcher both skip, so it never
 * shows up in the sidebar while the work runs. The copy survives as the
 * fallback for a rename that is refused.
 *
 * `watch.cancelled` is asked after 7-Zip returns and between landings. What
 * had already landed is taken back, which is safe because every landing is
 * at a name that was free: nothing that was there before is ever touched.
 */
export async function extractSevenTo(
  exe: string,
  file: string,
  entryPaths: readonly string[],
  destDir: string,
  password = '',
  watch?: SevenWatch & { cancelled?: () => boolean }
): Promise<
  | { ok: true; written: number }
  | { ok: false; reason: MemberFail | 'cancelled'; message?: string }
> {
  if (!existsSync(destDir)) return { ok: false, reason: 'failed' }
  // The listing fails EARLY on a container that cannot be read at all (a
  // wrong password, encrypted names), and counts what is coming so the
  // file-count fallback has something to be a fraction of. 7-Zip's own
  // filters do the member matching below.
  const listed = await listSeven(exe, file, password)
  if (!listed.ok) return { ok: false, reason: listed.reason }
  const clean = (e: string): string => e.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const wanted = entryPaths.map(clean)
  const base = resolve(destDir)
  const cancelled = (): boolean => watch?.cancelled?.() ?? false
  let written = 0
  const filters: string[] = []
  for (const w of wanted) {
    if (!w || w.split('/').some((s) => s === '..') || /^[a-z]:/i.test(w)) continue
    filters.push(w, `${w}/*`)
  }
  if (!filters.length) return { ok: true, written: 0 }
  // ONE call into a staging folder, not one per member (2026-08-31). The
  // old loop spawned a 7-Zip per file and each re-opened the container:
  // dragging a 561-file folder out of a 2GB archive was hundreds of full
  // re-reads, which is the same defect "Extract folder here" had. Everything
  // wanted is named in a single command line instead.
  let stage: string
  try {
    stage = await mkdtemp(join(base, '.prism-extract-'))
  } catch {
    return { ok: false, reason: 'failed', message: 'That folder cannot be written to.' }
  }
  const landed: string[] = []
  const gone = { recursive: true, force: true, maxRetries: 12, retryDelay: 150 }
  try {
    const args = [
      'x',
      `-o${stage}`,
      '-y',
      ...(password ? [`-p${password}`] : []),
      '--',
      file,
      ...filters
    ]
    const total = listed.entries.filter((e) =>
      wanted.some((w) => e.path === w || e.path.startsWith(w + '/'))
    ).length
    const r = watch
      ? await runWithProgress(exe, [...PROGRESS_ARGS, ...args], { ...watch, total })
      : await run(exe, args, 3600000)
    // A killed 7-Zip and a failed one look the same from here, so the
    // question is asked before the answer is read.
    if (cancelled()) return { ok: false, reason: 'cancelled' }
    if (!r.ok) {
      return {
        ok: false,
        reason: sevenFailReason(r.stderr),
        message: sevenMessage(r.stderr)
      }
    }
    // Each wanted entry now sits at `stage/<entry>`. Landing keeps the shape
    // BELOW it and drops the parents above it, which is the rule the panel
    // has always followed for a drag.
    for (const w of wanted) {
      if (cancelled()) {
        for (const t of landed) await rm(t, gone).catch(() => {})
        return { ok: false, reason: 'cancelled' }
      }
      const from = resolve(stage, ...w.split('/'))
      if (!existsSync(from)) continue
      let target = resolve(base, basename(w))
      const inside = relative(base, target)
      if (
        !inside ||
        inside.startsWith('..') ||
        inside.split(sep).includes('..') ||
        isAbsolute(inside)
      )
        continue
      if (existsSync(target)) target = join(base, uniqueName(base, basename(w)))
      try {
        await rename(from, target)
      } catch {
        // AWAITED: main is one thread, and a 2GB folder copied synchronously
        // freezes every window and the Range handler a playing film depends on.
        await cp(from, target, { recursive: true })
      }
      landed.push(target)
      written += 1
    }
    return { ok: true, written }
  } finally {
    await rm(stage, gone).catch(() => {})
  }
}
