/**
 * THE SIDEBAR SEARCHES THROUGH EVERYTHING WHEN IT CAN (2026-09-03, owner).
 *
 * Prism's own search is a bounded breadth-first walk - 20000 entries a
 * keystroke, so a network share can never hang the window - and on a tab
 * rooted at C:\ that bound is most of the drive left unvisited: "most
 * searches returned nothing". voidtools' Everything keeps a live index of
 * the whole machine and answers a whole-disk query in milliseconds through
 * its `es.exe` CLI, so when that CLI is on this machine the search goes
 * through it, scoped to the tab's root with `-path`, and the walk stays as
 * the fallback for machines without it, for an index that has not caught up
 * with a file made a second ago (the walk runs whenever Everything answers
 * NOTHING), and for the moments the service is down.
 *
 * DETECTED, never bundled: es.exe is a thin client for a service that has to
 * be installed and running anyway, so shipping the client alone would be a
 * button that does nothing. Found on PATH or in the usual install folders,
 * once, and cached. Run with execFile and an argument array only - a `$` in
 * a root or a name must never reach a shell.
 *
 * The 1.5 alpha's IPC lives under a named instance; es.ini beside the exe
 * normally carries that, and the retry with `-instance 1.5a` covers a copy
 * without one. Error 8 ("IPC not found") is the service being down, not the
 * tool being missing.
 */
import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { basename, extname, join } from 'path'
import { fileKind, isViewable } from '@shared/fileKind'
import { everythingArgs, isDirAttr, isHiddenAttr } from '@shared/everythingQuery'
import type { Term } from '@shared/searchQuery'
import type { SearchHit, SearchResult } from '@shared/types'
import { isSkipped } from '@shared/listRules'

let esPath: string | null | undefined

/** Where es.exe is, or null. Looked up once per run. */
export function findEverything(): Promise<string | null> {
  if (esPath !== undefined) return Promise.resolve(esPath)
  const home = process.env.USERPROFILE ?? ''
  const fixed = [
    join(home, '.local', 'bin', 'es.exe'),
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Everything', 'es.exe'),
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Everything', 'es.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Everything', 'es.exe')
  ]
  return new Promise((done) => {
    execFile('where.exe', ['es.exe'], { windowsHide: true }, (err, out) => {
      const fromPath = !err ? (out.split(/\r?\n/).find((l) => l.trim()) ?? '').trim() : ''
      esPath = fromPath && existsSync(fromPath) ? fromPath : (fixed.find((p) => existsSync(p)) ?? null)
      done(esPath)
    })
  })
}

/** Test seam. */
export function forgetEverything(): void {
  esPath = undefined
}

interface EsRow {
  filename: string
  attributes?: number
}

function run(exe: string, args: string[]): Promise<EsRow[]> {
  return new Promise((resolve, reject) => {
    execFile(
      exe,
      args,
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 8000 },
      (err, out) => {
        if (err) return reject(err)
        try {
          const rows = JSON.parse(out || '[]') as EsRow[]
          resolve(Array.isArray(rows) ? rows : [])
        } catch (e) {
          reject(e)
        }
      }
    )
  })
}

/**
 * Everything's answer for `terms` under `root`, in Prism's own hit shape and
 * under Prism's own listing rules: dotfiles, hidden entries and the shell's
 * junk folders are not results, and a file is a result only if Prism can
 * open it. Null when Everything is not here or could not answer, so the
 * caller walks instead.
 */
export async function searchEverything(
  root: string,
  terms: readonly Term[],
  maxHits: number
): Promise<SearchResult | null> {
  const exe = await findEverything()
  if (!exe || !terms.length) return null
  // Ask for more than the cap: the viewable-files rule drops rows after the
  // fact, and a folder of build output is mostly rows it drops.
  const base = ['-json', '-attributes', '-n', String(Math.max(maxHits * 8, 400)), '-path', root]
  const q = everythingArgs(terms)
  let rows: EsRow[]
  try {
    rows = await run(exe, [...base, ...q])
  } catch {
    try {
      rows = await run(exe, ['-instance', '1.5a', ...base, ...q])
    } catch {
      return null
    }
  }
  const hits: SearchHit[] = []
  const rootLower = root.replace(/[\\/]+$/, '').toLowerCase()
  for (const r of rows) {
    if (typeof r.filename !== 'string') continue
    const attr = r.attributes ?? 0
    const full = r.filename.replace(/[\\/]+$/, '')
    // Scoped by -path already; this is belt and braces against a root that
    // is itself the prefix of another folder's name (C:\Photos vs C:\Photos2).
    const under = full.toLowerCase().startsWith(rootLower + '\\')
    if (!under) continue
    const name = basename(full)
    if (!name || name.startsWith('.') || isSkipped(name) || isHiddenAttr(attr)) continue
    // Any ancestor between the root and the hit that the listing would hide
    // hides the hit too - the walk never enters those folders.
    const rel = full.slice(rootLower.length + 1)
    const parts = rel.split('\\')
    if (parts.slice(0, -1).some((p) => p.startsWith('.') || isSkipped(p))) continue
    const dir = parts.slice(0, -1).join('\\')
    if (isDirAttr(attr)) {
      hits.push({ path: full, name, kind: 'other', dir, isFolder: true })
    } else {
      const ext = extname(name)
      if (!isViewable(ext, name)) continue
      hits.push({ path: full, name, kind: fileKind(ext.toLowerCase(), name), dir })
    }
    if (hits.length >= maxHits) return { hits, truncated: true }
  }
  return { hits, truncated: false }
}
