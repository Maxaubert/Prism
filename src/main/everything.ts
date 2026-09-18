/**
 * Prism starts a bundled, private Everything index through indexerRuntime.
 * Every managed query targets its named instance, never a personal installation.
 * Standalone legacy callers can still discover an existing ES client; production
 * initializes the managed runtime before registering search IPC.
 */
import { execFile } from 'child_process'
import { managedIndexerRuntime } from './indexerRuntime'
import { existsSync } from 'fs'
import { basename, extname, join } from 'path'
import { fileKind, isViewable } from '@shared/fileKind'
import { everythingArgs, isDirAttr, isHiddenAttr } from '@shared/everythingQuery'
import type { Term } from '@shared/searchQuery'
import type { SearchHit, SearchResult } from '@shared/types'
import { isSkipped } from '@shared/listRules'

let esPath: string | null | undefined

/** Where es.exe is, or null. Looked up once per run. */
export function findEverything(root?: string): Promise<string | null> {
  const managed = managedIndexerRuntime()
  if (managed) return managed.ensureReady(root).then((endpoint) => endpoint?.exe ?? null)
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
      esPath =
        fromPath && existsSync(fromPath) ? fromPath : (fixed.find((p) => existsSync(p)) ?? null)
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
  const exe = await findEverything(root)
  if (!exe || !terms.length) return null
  // Ask for more than the cap: the viewable-files rule drops rows after the
  // fact, and a folder of build output is mostly rows it drops.
  const managed = managedIndexerRuntime()
  const instance = managed ? ['-instance', managed.endpoint.instance] : []
  const base = [
    ...instance,
    '-json',
    '-attributes',
    '-n',
    String(Math.max(maxHits * 8, 400)),
    '-path',
    root
  ]
  const q = everythingArgs(terms)
  let rows: EsRow[]
  try {
    rows = await run(exe, [...base, ...q])
  } catch {
    if (managed) return null
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
