import { statSync } from 'fs'
import { readFile, stat } from 'fs/promises'
import { basename, extname, isAbsolute } from 'path'
import type { ArchiveEntry, ArchiveMeta, DirEntry, DirListing, ViewerFile } from '@shared/types'
import type { BrowseSearchResult } from '@shared/browse'
import {
  MAX_NEST,
  below,
  browsableArchive,
  containerCandidates,
  hasEntry,
  innerOf,
  levelOf,
  placeOf
} from '@shared/archivePlace'
import { withImpliedFolders } from '@shared/archiveTree'
import { fileKind, isViewable } from '@shared/fileKind'
import { matchesQuery, parseQuery } from '@shared/searchQuery'
import { archiveTooLarge, listZipData, unpackMember, type MemberFail } from './archive'
import { extractSeven, listSeven } from './sevenZip'
import { AUTO_PREVIEW_BYTES, type MemberTemp } from './memberTemp'

/**
 * PLACES INSIDE ARCHIVES, main's half (#300; owner, 2026-10-06: "make zips seem
 * like ordinary folders ... you open them like any other folder but you get the
 * zip relevant right click menu options. this would work the same in project
 * mode"). Spec: docs/superpowers/specs/2026-10-06-zip-as-folder-design.md.
 *
 * The Explorer's list, the project tree, a member opened or previewed, the
 * search and the restore all ask here first, by ONE branch at their top: a path
 * with no segment named like an archive costs nothing (no stat at all), and one
 * whose container turns out to be a FOLDER named `x.zip` is an ordinary folder.
 *
 * A container is parsed ONCE and kept, keyed by path, size and modified time,
 * so walking around inside it is a filter over memory. A zip is read with
 * `fs/promises` and parsed from the Buffer (`new AdmZip(path)` is a
 * readFileSync on main's one thread), and only up to `SEVEN_LIST_BYTES`: past
 * it, and for every other format, 7-Zip lists and unpacks (88 ms MEASURED on a
 * 1.9 GB zip, 2026-08-31), so a 500 MB zip is never held in main's memory to
 * show one folder of it.
 */

/** Zips bigger than this are listed and unpacked through 7-Zip. Writes keep
 *  adm-zip's own 600 MB cap (archive.ts), as they always have. MEASURED
 *  2026-10-06 on 600-member zips: adm-zip's parse on main's thread is 4 to
 *  7 ms whatever the size (it reads the central directory), but it needs the
 *  whole container read first (`fs/promises`, off the thread: 20 ms at 64 MB,
 *  76 ms at 300 MB, 174 ms at 590 MB) and HELD in memory, and every member
 *  unpacked reads it again. 7-Zip lists any of them in about 25 ms and holds
 *  nothing, so past 64 MB it is the cheaper of the two. */
export const SEVEN_LIST_BYTES = 64 * 1024 * 1024

/** Unpacks running at once. Each in-app one reads the WHOLE container (up to
 *  `SEVEN_LIST_BYTES`) and each 7-Zip one is a process, so arrowing through a
 *  zip with the preview open fired one per row, all at once (review of #300:
 *  thirty rows of a 60 MB zip held about 1.8 GB). */
const UNPACK_SLOTS = 2

/**
 * A slot for one unpack, NEWEST FIRST: the row the user arrived at last is the
 * one on screen, so it goes ahead of the ones they arrowed past, which still
 * run (their answer is cached for a step back) but no longer in front of it.
 */
export function createNewestFirst(slots: number) {
  let running = 0
  const waiting: Array<() => void> = []
  const next = (): void => {
    if (running >= slots) return
    const go = waiting.pop()
    if (!go) return
    running += 1
    go()
  }
  return async function run<T>(job: () => Promise<T>): Promise<T> {
    await new Promise<void>((go) => {
      waiting.push(go)
      next()
    })
    try {
      return await job()
    } finally {
      running -= 1
      next()
    }
  }
}

/** The parse cache's bounds: containers, and entries across all of them. */
const KEEP_CONTAINERS = 8
const KEEP_ENTRIES = 200_000

export type PlaceFail = MemberFail | 'missing' | 'deep' | 'nest-big'

/** A nested archive is unpacked WHOLE to be walked into, on the way to the
 *  listing, with no bar and no Cancel (review of #300: a 10 GB `.tar` inside a
 *  `.tar.gz` filled the temp drive before the folder could answer). Past this
 *  the place refuses and says to extract it first. */
export const NEST_UNPACK_BYTES = 1024 * 1024 * 1024

export interface ArchiveBrowseDeps {
  /** The bundled 7-Zip, or null when there is none. */
  sevenExe: () => string | null
  /** The password remembered for a container this session, '' for none. */
  password: (container: string) => string
  /** A password that worked: remembered for the session. */
  remember: (container: string, password: string) => void
  temp: MemberTemp
}

interface Parsed {
  size: number
  mtimeMs: number
  entries: ArchiveEntry[]
  encryption: ArchiveMeta['encryption']
  viaSeven: boolean
}

/** A place resolved down to its innermost container. */
export interface Place {
  /** The outermost container on disk. */
  outer: string
  /** The innermost container's real file (a temp copy when nested). */
  real: string
  /** Its root as the address bar spells it. */
  base: string
  chain: string[]
  /** Forward-slash name inside the innermost container, '' at its root. */
  inner: string
  /** The entry `inner` names, null at the root. */
  entry: ArchiveEntry | null
  parsed: Parsed
  nested: boolean
  packed: number
}

export type Resolved = { ok: true; place: Place } | { ok: false; reason: PlaceFail; container: string; base: string; inner: string }

/** Names an extractor must never be handed, and so are never listed. */
function hostile(path: string): boolean {
  const p = path.replace(/\\/g, '/')
  return !p || p.startsWith('/') || /^[a-z]:/i.test(p) || p.split('/').some((s) => s === '..') || p.includes('\0')
}

const collator = new Intl.Collator(undefined, { numeric: true })
const byName = (a: { name: string }, b: { name: string }): number => collator.compare(a.name, b.name)

/** The container a path is inside, by a synchronous stat (the restore's
 *  check, #300): a stat of the candidates only, never a read of the zip. */
export function containerSync(path: string): string | null {
  if (typeof path !== 'string' || !isAbsolute(path)) return null
  for (const candidate of containerCandidates(path)) {
    try {
      const s = statSync(candidate)
      if (s.isFile()) return candidate
      if (!s.isDirectory()) return null
    } catch {
      return null
    }
  }
  return null
}

export function createArchiveBrowse(deps: ArchiveBrowseDeps) {
  const parsed = new Map<string, Parsed>()
  const slot = createNewestFirst(UNPACK_SLOTS)

  const seven = (real: string, size: number): boolean =>
    extname(real).toLowerCase() !== '.zip' || size > SEVEN_LIST_BYTES

  /** One container's entries, from memory when it has not changed. */
  async function read(
    real: string,
    password?: string
  ): Promise<{ ok: true; parsed: Parsed } | { ok: false; reason: MemberFail }> {
    let info: { size: number; mtimeMs: number }
    try {
      info = await stat(real)
    } catch {
      return { ok: false, reason: 'failed' }
    }
    const key = real.toLowerCase()
    const hit = parsed.get(key)
    if (hit && hit.size === info.size && hit.mtimeMs === info.mtimeMs) {
      parsed.delete(key)
      parsed.set(key, hit)
      return { ok: true, parsed: hit }
    }
    const viaSeven = seven(real, info.size)
    let entries: ArchiveEntry[]
    let encryption: ArchiveMeta['encryption'] = 'none'
    if (!viaSeven) {
      try {
        const r = listZipData(await readFile(real))
        entries = r.entries
        encryption = r.encryption
      } catch {
        return { ok: false, reason: 'failed' }
      }
    } else {
      const exe = deps.sevenExe()
      if (!exe) return { ok: false, reason: 'failed' }
      const pw = password ?? deps.password(real)
      const r = await listSeven(exe, real, pw)
      if (!r.ok) return r
      if (pw) deps.remember(real, pw)
      entries = r.entries
      if (entries.some((e) => e.encrypted && !e.dir)) encryption = 'aes'
    }
    const clean = withImpliedFolders(entries.filter((e) => !hostile(e.path)))
    const out: Parsed = { size: info.size, mtimeMs: info.mtimeMs, entries: clean, encryption, viaSeven }
    parsed.delete(key)
    parsed.set(key, out)
    let total = 0
    for (const p of parsed.values()) total += p.entries.length
    for (const [k, p] of parsed) {
      if (parsed.size <= KEEP_CONTAINERS && total <= KEEP_ENTRIES) break
      if (k === key) continue
      parsed.delete(k)
      total -= p.entries.length
    }
    return { ok: true, parsed: out }
  }

  /** One member of a container out to the run's temp folder. */
  async function unpack(
    real: string,
    p: Parsed,
    member: string,
    password?: string
  ): Promise<{ ok: true; path: string } | { ok: false; reason: MemberFail }> {
    const pw = password ?? deps.password(real)
    const out = await deps.temp.ensure(real, member, (dir) =>
      slot(async () => {
        if (p.viaSeven) {
          const exe = deps.sevenExe()
          if (!exe) return { ok: false, reason: 'failed' as const }
          return extractSeven(exe, real, member, pw, dir)
        }
        return unpackMember(real, member, dir, pw || undefined)
      })
    )
    if (out.ok && pw) deps.remember(real, pw)
    return out
  }

  /**
   * Where a path is: its outermost container found by a stat walk, then each
   * segment checked against the container's own listing, unpacking a nested
   * container on the way (never deeper than `MAX_NEST`). Undefined when the
   * path is not inside an archive at all. `enterLast` treats a path that ENDS
   * on an archive member as that archive's root (browsing), not as the file
   * (opening it).
   */
  async function resolvePlace(
    path: string,
    { enterLast = true, password }: { enterLast?: boolean; password?: string } = {}
  ): Promise<Resolved | undefined> {
    if (typeof path !== 'string' || !isAbsolute(path) || path.length > 4096) return undefined
    let outer: string | null = null
    for (const candidate of containerCandidates(path)) {
      try {
        const s = await stat(candidate)
        if (s.isFile()) {
          outer = candidate
          break
        }
        if (!s.isDirectory()) return undefined
      } catch {
        return undefined
      }
    }
    if (!outer) return undefined
    const rest = innerOf(outer, path) ?? ''
    let real = outer
    let base = outer
    const chain = [outer]
    let segs = rest ? rest.split('/') : []
    for (;;) {
      // A password handed in is for whichever container asks for one first:
      // the renderer asks again, naming that container, if it was not.
      const r = await read(real, password)
      if (r.ok && password) password = undefined
      if (!r.ok) return { ok: false, reason: r.reason, container: real, base, inner: '' }
      let acc = ''
      let entry: ArchiveEntry | null = null
      let enter: ArchiveEntry | null = null
      for (let i = 0; i < segs.length; i++) {
        const want = acc ? `${acc}/${segs[i]}` : segs[i]
        const found = hasEntry(r.parsed.entries, want)
        if (!found) return { ok: false, reason: 'missing', container: real, base, inner: acc }
        acc = found.path.replace(/\/+$/, '')
        entry = found
        const last = i === segs.length - 1
        if (!found.dir) {
          if (browsableArchive(found.name) && (!last || enterLast)) {
            enter = found
            segs = segs.slice(i + 1)
            break
          }
          if (!last) return { ok: false, reason: 'missing', container: real, base, inner: acc }
        }
      }
      if (!enter) {
        const place: Place = {
          outer,
          real,
          base,
          chain,
          inner: acc,
          entry,
          parsed: r.parsed,
          nested: chain.length > 1,
          packed: r.parsed.size
        }
        return { ok: true, place }
      }
      if (chain.length >= MAX_NEST) return { ok: false, reason: 'deep', container: real, base, inner: acc }
      if (enter.size > NEST_UNPACK_BYTES || !(await deps.temp.room(enter.size)))
        return { ok: false, reason: 'nest-big', container: real, base, inner: acc }
      const inner = await unpack(real, r.parsed, enter.path)
      if (!inner.ok) return { ok: false, reason: inner.reason, container: real, base, inner: acc }
      base = placeOf(base, enter.path)
      chain.push(base)
      real = inner.path
    }
  }

  /** What the strip, the crumbs and the menus are told. */
  function meta(place: Place): ArchiveMeta {
    const e = place.parsed.entries
    return {
      container: place.real,
      base: place.base,
      chain: place.chain,
      outer: place.outer,
      inner: place.inner,
      display: basename(place.base.replace(/\\/g, '/')),
      files: e.filter((x) => !x.dir).length,
      folders: e.filter((x) => x.dir).length,
      packed: place.packed,
      unpacked: e.reduce((n, x) => n + (x.dir ? 0 : x.size), 0),
      readOnly:
        place.nested ||
        extname(place.real).toLowerCase() !== '.zip' ||
        archiveTooLarge(place.parsed.size),
      nested: place.nested,
      encryption: place.parsed.encryption
    }
  }

  function memberFile(place: Place, e: ArchiveEntry): ViewerFile {
    const name = e.name || basename(e.path)
    const ext = extname(name).toLowerCase()
    return {
      path: placeOf(place.base, e.path),
      name,
      ext,
      kind: fileKind(ext, name),
      size: e.size,
      mtimeMs: e.mtime ?? 0,
      member: true,
      ...(typeof e.packed === 'number' ? { packed: e.packed } : {}),
      ...(e.encrypted ? { encrypted: true as const } : {})
    }
  }

  /**
   * One level as a listing. 'explorer' lists every member, as the Explorer
   * lists every file; 'tree' keeps what Prism can show and counts the rest,
   * as `listDir` does for the project tree.
   */
  function listing(place: Place, mode: 'explorer' | 'tree'): DirListing {
    const level = levelOf(place.parsed.entries, place.inner)
    const folders: DirEntry[] = level.folders.map((f) => ({
      path: placeOf(place.base, f.path),
      name: f.name,
      mtimeMs: f.mtime ?? 0,
      size: f.size,
      items: f.items
    }))
    let hidden = 0
    const files: ViewerFile[] = []
    for (const e of level.files) {
      const file = memberFile(place, e)
      if (mode === 'tree' && !isViewable(file.ext, file.name)) hidden += 1
      else files.push(file)
    }
    return {
      folders: folders.sort(byName),
      files: files.sort(byName),
      ...(hidden ? { hidden } : {}),
      archive: meta(place)
    }
  }

  /** The words a refusal is shown with, in the Explorer's own error line. */
  function failText(reason: PlaceFail): string {
    if (reason === 'deep') return 'Archives nested this deep are not opened.'
    if (reason === 'nest-big') return 'This archive inside an archive is too large to open in place. Extract it first.'
    if (reason === 'missing') return 'That folder is no longer in the archive.'
    if (reason === 'password' || reason === 'aes') return 'This archive needs its password.'
    return "This archive can't be read. It may be damaged or incomplete."
  }

  return {
    resolve: resolvePlace,
    meta,
    listing,
    failText,
    unpack,
    /** Forget a container's parse (Prism rewrote it, or it changed). */
    forget(real: string): void {
      parsed.delete(real.toLowerCase())
    },
    /**
     * One member out to the temp folder for a viewer. `force` lifts the
     * automatic-preview limit (an explicit Open).
     */
    async member(
      path: string,
      password?: string,
      force = false
    ): Promise<
      | { ok: true; path: string; kind: ViewerFile['kind'] }
      | { ok: false; reason: PlaceFail | 'too-big' | 'space'; size?: number; container?: string }
    > {
      const r = await resolvePlace(path, { enterLast: false, password })
      if (!r) return { ok: false, reason: 'failed' }
      if (!r.ok) return { ok: false, reason: r.reason, container: r.container }
      const e = r.place.entry
      if (!e || e.dir) return { ok: false, reason: 'failed' }
      if (!force && e.size > AUTO_PREVIEW_BYTES)
        return { ok: false, reason: 'too-big', size: e.size, container: r.place.real }
      if (!(await deps.temp.room(e.size))) return { ok: false, reason: 'space', size: e.size }
      const out = await unpack(r.place.real, r.place.parsed, e.path, password)
      if (!out.ok) return { ok: false, reason: out.reason, container: r.place.real }
      return { ok: true, path: out.path, kind: fileKind(extname(out.path).toLowerCase(), basename(out.path)) }
    },
    /**
     * The members beside one (the arrows' list) and its index: the archive's
     * answer to `open:within`. Viewable members only, as the tree lists them,
     * plus the one asked for whatever it is.
     */
    async siblings(path: string): Promise<{ files: ViewerFile[]; index: number } | null> {
      const r = await resolvePlace(path, { enterLast: false })
      if (!r?.ok || !r.place.entry || r.place.entry.dir) return null
      const parent = r.place.inner.includes('/') ? r.place.inner.slice(0, r.place.inner.lastIndexOf('/')) : ''
      const files = listing({ ...r.place, inner: parent }, 'tree').files
      const want = placeOf(r.place.base, r.place.entry.path).toLowerCase()
      const index = files.findIndex((f) => f.path.toLowerCase() === want)
      if (index >= 0) return { files, index }
      return { files: [memberFile(r.place, r.place.entry)], index: 0 }
    },
    /**
     * The search inside an archive: the query over every entry below the
     * folder (the Explorer's "this folder and subfolders"), from memory, one
     * answer, no walk and no index.
     */
    async search(path: string, query: string, max = 5000): Promise<BrowseSearchResult | undefined> {
      const r = await resolvePlace(path)
      if (!r) return undefined
      const result: BrowseSearchResult = {
        path,
        listing: { folders: [], files: [] },
        scanned: 0,
        unreadable: 0,
        skippedLinks: 0,
        truncated: false,
        cancelled: false
      }
      if (!r.ok || (r.place.entry && !r.place.entry.dir)) {
        result.unreadable = 1
        return result
      }
      const terms = parseQuery(query)
      const scope = below(r.place.parsed.entries, r.place.inner)
      result.scanned = scope.length
      result.listing.archive = meta(r.place)
      for (const e of scope) {
        if (!query.trim() || !matchesQuery(e.name, terms)) continue
        if (result.listing.folders.length + result.listing.files.length >= max) {
          result.truncated = true
          break
        }
        if (e.dir) {
          const level = levelOf(r.place.parsed.entries, e.path)
          result.listing.folders.push({
            path: placeOf(r.place.base, e.path),
            name: e.name,
            mtimeMs: e.mtime ?? 0,
            size: level.folders.reduce((n, f) => n + f.size, 0) + level.files.reduce((n, f) => n + f.size, 0),
            items: level.folders.reduce((n, f) => n + f.items + 1, 0) + level.files.length
          })
        } else result.listing.files.push(memberFile(r.place, e))
      }
      return result
    },
    /** What the archive card shows (#300): totals and the top two levels. */
    async summary(path: string): Promise<
      | {
          ok: true
          meta: ArchiveMeta
          /** The single top folder a "download as zip" makes, if that is all
           *  there is. */
          top: string | null
          rows: Array<{ name: string; dir: boolean; size: number }>
        }
      | { ok: false; reason: PlaceFail }
    > {
      const r = await resolvePlace(path)
      if (!r) return { ok: false, reason: 'failed' }
      if (!r.ok) return { ok: false, reason: r.reason }
      let level = levelOf(r.place.parsed.entries, r.place.inner)
      let top: string | null = null
      if (level.folders.length === 1 && !level.files.length) {
        top = level.folders[0].name
        level = levelOf(r.place.parsed.entries, level.folders[0].path)
      }
      const rows = [
        ...level.folders.sort(byName).map((f) => ({ name: f.name, dir: true, size: f.size })),
        ...level.files.sort(byName).map((f) => ({ name: f.name, dir: false, size: f.size }))
      ].slice(0, 200)
      return { ok: true, meta: meta(r.place), top, rows }
    }
  }
}

export type ArchiveBrowse = ReturnType<typeof createArchiveBrowse>
