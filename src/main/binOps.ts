import { mkdir, readdir, readFile, rename, rm, unlink } from 'fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'path'
import type { BinDeleteResult, BinRestoreResult, MoveClash, MoveOnClash } from '@shared/ipcTypes'
import { inBinFolder } from '@shared/binPath'
import { uniqueNameAsync } from './fileOps'
import { exists, sleep } from './fsUtil'
import { parseInfo } from './binRestore'

/**
 * RESTORE, DELETE PERMANENTLY AND EMPTY (Recycle Bin feature, D13 to D15),
 * done by Prism itself on the bin's `$I`/`$R` pairs: no shell, no process, so
 * each one has a count and a Cancel. Nothing here is electron: the handlers in
 * ipc/files.ts fill in `BinEnv` (the wall, the real or fake bin folders, the
 * trash call), and the tests fill in their own.
 *
 * THE RENDERER CAN NEVER USE THESE TO TOUCH AN ARBITRARY FILE. A path is acted
 * on only when it is a `$R<id>` entry whose parent is one of the bin folders
 * and the wall's current bin grant (the last listing) holds it; anything else
 * is refused and left untouched. Empty takes no paths at all: it walks the bin
 * folders itself.
 */

export interface BinEnv {
  /** This user's bin folder on each drive (binRoots; the seam's in an e2e). */
  dirs: () => Promise<string[]>
  /** Is this exactly an entry the last bin listing granted (pathWall.binGranted)? */
  granted: (path: string) => boolean
  /** Move to the Recycle Bin (Replace sends the old item there first). */
  trash: (path: string) => Promise<void>
  /** Delete a file or folder tree for good (default `fs.rm`; tests swap it). */
  remove?: (path: string) => Promise<void>
  /** `PRISM_E2E_SLOW_BIN`: ms added per item, `--e2e` only. */
  slowMs?: number
}

/** `done` of `total` items finished. */
export type BinTick = (done: number, total: number) => void

const key = (p: string): string => resolve(p).toLowerCase()
const defaultRemove = (p: string): Promise<void> => rm(p, { recursive: true, force: true })

interface Entry {
  /** The `$R` entry. */
  r: string
  dir: string
  /** `<id><ext>`, after `$R` and `$I`. */
  id: string
}

/** The entries the env lets through, and the paths it refused. */
async function accept(env: BinEnv, paths: readonly unknown[]): Promise<{ ok: Entry[]; refused: string[] }> {
  const dirs = new Set((await env.dirs()).map(key))
  const ok: Entry[] = []
  const refused: string[] = []
  for (const p of paths) {
    const good =
      typeof p === 'string' &&
      isAbsolute(p) &&
      /^\$R./i.test(basename(p)) &&
      dirs.has(key(dirname(p))) &&
      env.granted(p)
    if (good) ok.push({ r: p, dir: dirname(p), id: basename(p).slice(2) })
    else if (typeof p === 'string') refused.push(p)
  }
  return { ok, refused }
}

const infoPath = (e: Entry): string => join(e.dir, `$I${e.id}`)
/** `$I` records read together, as the bin reader does. */
const READ_AT_ONCE = 64
const pause = (env: BinEnv): Promise<void> => (env.slowMs ? sleep(env.slowMs) : Promise.resolve())

/** Where the record says the item came from, or null when it cannot be trusted:
 *  unreadable, not a local drive path, or pointing into a bin folder. */
async function originOf(e: Entry): Promise<string | null> {
  const info = parseInfo(await readFile(infoPath(e)).catch(() => Buffer.alloc(0)))
  if (!info || !/^[A-Za-z]:[\\/]/.test(info.path) || inBinFolder(info.path)) return null
  return info.path
}

/**
 * RESTORE (D13): each `$R` back at its original path with `rename` (same drive,
 * so O(1) even for a folder of a million files), then its `$I` dropped. A
 * missing original folder is made. A name already taken is a CLASH: with 'ask'
 * nothing moves and the clashes come back; 'keep-both' lands the item as
 * `name (2)`; 'replace' sends what is there to the bin first. Two binned
 * copies of one path in the same batch never eat each other: the later one is
 * always renamed. A restore that fails leaves the item in the bin.
 */
export async function restoreItems(
  env: BinEnv,
  paths: readonly string[],
  onClash: MoveOnClash,
  signal?: AbortSignal,
  tick?: BinTick
): Promise<BinRestoreResult> {
  const { ok: entries, refused } = await accept(env, paths)
  const out: BinRestoreResult = {
    ok: false,
    restored: [],
    left: [],
    cancelled: false,
    clashes: [],
    replaced: [],
    failed: []
  }
  if (refused.length) out.refused = true
  // The records a few at a time (review, 2026-11-10): all at once opened every
  // `$I` together, and past about 8,190 open files Windows' C runtime answers
  // EMFILE, so a big Restore left hundreds "could not be put back".
  const origins: Array<string | null> = []
  for (let i = 0; i < entries.length; i += READ_AT_ONCE)
    origins.push(...(await Promise.all(entries.slice(i, i + READ_AT_ONCE).map(originOf))))
  const todo: Array<{ e: Entry; target: string }> = []
  for (const [i, e] of entries.entries()) {
    const target = origins[i]
    if (target) todo.push({ e, target })
    else out.failed.push(e.r)
  }

  if (onClash === 'ask') {
    const seen = new Set<string>()
    for (const { e, target } of todo) {
      const k = key(target)
      if (seen.has(k) || (await exists(target))) out.clashes.push({ path: e.r, name: basename(target) } satisfies MoveClash)
      seen.add(k)
    }
    if (out.clashes.length) {
      out.left = [...refused, ...out.failed, ...todo.map((t) => t.e.r)]
      return out
    }
  }

  // Names already put down in this batch, by folder, so a twin gets a new name.
  const landed = new Map<string, Set<string>>()
  for (const [n, { e, target }] of todo.entries()) {
    if (signal?.aborted) {
      out.cancelled = true
      out.left.push(...todo.slice(n).map((t) => t.e.r))
      break
    }
    await pause(env)
    try {
      const dir = dirname(target)
      const dk = key(dir)
      const names = landed.get(dk) ?? new Set<string>()
      let final = target
      const twin = names.has(basename(target).toLowerCase())
      if (twin || (await exists(target))) {
        // Only an explicit 'replace' sends what is there to the bin: an 'ask'
        // that finds the name taken after its check (a race) keeps both.
        if (twin || onClash !== 'replace') {
          final = join(dir, await uniqueNameAsync(dir, basename(target), names))
        } else {
          // 'replace': the item in the way goes to the bin, not away.
          await env.trash(target)
          out.replaced.push(target)
        }
      }
      await mkdir(dir, { recursive: true })
      await rename(e.r, final)
      await unlink(infoPath(e)).catch(() => {})
      names.add(basename(final).toLowerCase())
      landed.set(dk, names)
      out.restored.push(final)
    } catch {
      out.failed.push(e.r)
    }
    tick?.(n + 1, todo.length)
  }
  out.left.push(...refused, ...out.failed)
  out.ok = !out.cancelled && out.left.length === 0
  return out
}

/** One item for good: the `$R` (file or tree), then its `$I`. */
async function dropPair(env: BinEnv, e: Entry): Promise<void> {
  await (env.remove ?? defaultRemove)(e.r)
  await unlink(infoPath(e)).catch(() => {})
}

/**
 * DELETE PERMANENTLY (D14): `$R` removed (a folder with its whole tree), then
 * its `$I`, one item at a time so there is progress and Cancel. Not undoable.
 */
export async function deleteItems(
  env: BinEnv,
  paths: readonly string[],
  signal?: AbortSignal,
  tick?: BinTick
): Promise<BinDeleteResult> {
  const { ok: entries, refused } = await accept(env, paths)
  const out: BinDeleteResult = { ok: false, deleted: 0, left: [...refused], cancelled: false, total: entries.length + refused.length }
  if (refused.length) out.refused = true
  for (const [n, e] of entries.entries()) {
    if (signal?.aborted) {
      out.cancelled = true
      out.left.push(...entries.slice(n).map((x) => x.r))
      break
    }
    await pause(env)
    try {
      await dropPair(env, e)
      out.deleted++
    } catch {
      out.left.push(e.r)
    }
    tick?.(n + 1, entries.length)
  }
  out.ok = !out.cancelled && out.left.length === 0
  return out
}

const EMPTY_AT_ONCE = 24
const EMPTY_PASSES = 10

/**
 * EMPTY (D15): every `$I`/`$R` pair of this user's bin on every drive, 24 at a
 * time (one at a time under the slow seam), counted and stoppable. The `$I`
 * files ARE the bin's index, so removing the pairs is what Windows does
 * underneath. `desktop.ini` and orphan halves are never touched. A pass that
 * finds nothing ends it, so a pair another program binned meanwhile goes too;
 * a pair that cannot be deleted is tried once and reported.
 */
export async function emptyBin(env: BinEnv, signal?: AbortSignal, tick?: BinTick): Promise<BinDeleteResult> {
  const out: BinDeleteResult = { ok: false, deleted: 0, left: [], cancelled: false, total: 0 }
  const dirs = await env.dirs()
  const failed = new Set<string>()
  let total = 0
  let done = 0
  for (let pass = 0; pass < EMPTY_PASSES && !out.cancelled; pass++) {
    const found: Entry[] = []
    for (const dir of dirs) {
      const names = await readdir(dir).catch(() => [] as string[])
      // One map from a name's lower case to its spelling (review, 2026-11-10):
      // finding each `$R` by walking the whole list again held main's loop for
      // seconds at 10,000 pairs.
      const spelled = new Map(names.map((n) => [n.toLowerCase(), n]))
      for (const n of names) {
        if (!n.startsWith('$I')) continue
        const real = spelled.get(`$r${n.slice(2)}`.toLowerCase())
        if (!real) continue
        const e: Entry = { r: join(dir, real), dir, id: real.slice(2) }
        if (!failed.has(e.r)) found.push(e)
      }
    }
    if (!found.length) break
    total += found.length
    const width = env.slowMs ? 1 : EMPTY_AT_ONCE
    for (let i = 0; i < found.length; i += width) {
      if (signal?.aborted) {
        out.cancelled = true
        break
      }
      await Promise.all(
        found.slice(i, i + width).map(async (e) => {
          await pause(env)
          try {
            await dropPair(env, e)
            out.deleted++
          } catch {
            failed.add(e.r)
          }
          tick?.(++done, total)
        })
      )
    }
  }
  out.total = total
  out.left = [...failed]
  out.ok = !out.cancelled && failed.size === 0
  return out
}
