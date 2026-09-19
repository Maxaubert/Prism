import { execFile } from 'child_process'
import { findEverything } from './everything'
import { nativeBrowseQuery } from '@shared/browseQuery'
import { dirname, resolve, sep } from 'path'
import { managedIndexerRuntime, type IndexerEndpoint } from './indexerRuntime'
import { findRunningEverything } from './existingEverything'
import type { BrowseSearchWindowRequest } from '@shared/browse'

const indexedRoots = new Map<string, number>()
// ES 1.1.0.38 uses UINT64_MAX to disable a count cap inherited from es.ini.
const ES_UNLIMITED_COUNT = '18446744073709551615'
export function clearEverythingBrowseCache(): void {
  indexedRoots.clear()
}

async function* queryEndpoints(root: string, signal: AbortSignal): AsyncGenerator<IndexerEndpoint> {
  const managed = managedIndexerRuntime()
  if (managed?.useExistingIndex) {
    const existing = await findRunningEverything(managed.endpoint.exe, signal)
    if (existing && !signal.aborted) yield existing
  }
  if (signal.aborted) return
  const exe = await findEverything(root, signal)
  if (exe && !signal.aborted) yield { exe, instance: managed?.endpoint.instance ?? '' }
}

/** Indexed totals cover indexed descendants; callers label them as indexed estimates. */
export async function getIndexedFolderSizes(
  paths: readonly string[],
  signal: AbortSignal = new AbortController().signal
): Promise<Map<string, { bytes: number }> | null> {
  if (!paths.length) return new Map()
  if (signal.aborted) return null
  for await (const endpoint of queryEndpoints(dirname(paths[0]), signal)) {
    const values = await folderSizesFrom(endpoint, paths, signal)
    if (values?.size) return values
  }
  return null
}

async function folderSizesFrom(
  { exe, instance: name }: IndexerEndpoint,
  paths: readonly string[],
  signal: AbortSignal
): Promise<Map<string, { bytes: number }> | null> {
  const instance = name ? ['-instance', name] : []
  const values = new Map<string, { bytes: number }>()
  try {
    for (let offset = 0; offset < paths.length; offset += 32) {
      const batch = paths.slice(offset, offset + 32)
      const requested = new Map(batch.map((path) => [resolve(path).toLowerCase(), path]))
      const patterns = batch.map((path) => resolve(path).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      const rows = await run(
        exe,
        [
          ...instance,
          '-json',
          '-attributes',
          '-size',
          '-n',
          String(batch.length),
          '-match-path',
          '-search*',
          `folder:regex:"^(${patterns.join('|')})$"`
        ],
        signal
      )
      for (const row of rows) {
        const path = requested.get(resolve(row.filename).toLowerCase())
        if (
          path &&
          (row.attributes & 16) !== 0 &&
          (row.attributes & 1024) === 0 &&
          typeof row.size === 'number' &&
          Number.isSafeInteger(row.size) &&
          row.size >= 0
        ) {
          values.set(path, { bytes: row.size })
        }
      }
    }
    return values
  } catch {
    return null
  }
}

export interface IndexedEntry {
  filename: string
  attributes: number
  size?: number
  date_modified?: number
}

function runOutput(exe: string, args: string[], signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    // ES uses a legacy command-line parser. -search* consumes the remaining
    // command line literally, so Node must not backslash-escape query quotes.
    // Fixed options precede it; the query cannot become another CLI switch.
    // This is CreateProcess through execFile, never a shell command.
    const commandArgs = args.map((arg, index) =>
      index < args.length - 1 && /\s/.test(arg) ? `"${arg}"` : arg
    )
    execFile(
      exe,
      commandArgs,
      {
        windowsHide: true,
        windowsVerbatimArguments: true,
        signal,
        timeout: 2000,
        maxBuffer: 4 * 1024 * 1024
      },
      (error, output) => {
        if (error) return reject(error)
        resolve(output)
      }
    )
  })
}

function indexedEntry(row: unknown): row is IndexedEntry {
  if (!row || typeof row !== 'object') return false
  const value = row as IndexedEntry
  return typeof value.filename === 'string' && typeof value.attributes === 'number'
}

async function run(exe: string, args: string[], signal: AbortSignal): Promise<IndexedEntry[]> {
  const rows: unknown = JSON.parse((await runOutput(exe, args, signal)) || '[]')
  if (!Array.isArray(rows)) throw new Error('Invalid Everything response')
  return rows.filter(indexedEntry)
}

export interface IndexedSearchWindow {
  offset: number
  total: number
  rows: Array<IndexedEntry | null>
}

/** Count and viewport are bounded IPC requests, not a full result download. */
export async function searchEverythingBrowseWindow(
  root: string,
  query: string,
  window: BrowseSearchWindowRequest,
  signal: AbortSignal
): Promise<IndexedSearchWindow | null> {
  const properties = {
    name: 'name',
    path: 'path',
    type: 'extension',
    size: 'size',
    modified: 'date-modified'
  }
  for await (const { exe, instance: name } of queryEndpoints(root, signal)) {
    const instance = name ? ['-instance', name] : []
    const scope = [
      '-count',
      ES_UNLIMITED_COUNT,
      '-path',
      root,
      '-search*',
      `<${nativeBrowseQuery(query)}>`
    ]
    try {
      const [count, output] = await Promise.all([
        runOutput(exe, [...instance, '-get-result-count', '-no-digit-grouping', ...scope], signal),
        runOutput(
          exe,
          [
            ...instance,
            '-json',
            '-attributes',
            '-size',
            '-date-modified',
            '-viewport-offset',
            String(window.offset),
            '-viewport-count',
            String(window.limit),
            '-sort',
            `${properties[window.sort.key]}-${window.sort.direction === 'desc' ? 'descending' : 'ascending'}`,
            ...scope
          ],
          signal
        )
      ])
      const total = Number(count.trim())
      const rows: unknown = JSON.parse(output || '[]')
      if (!/^\d+$/.test(count.trim()) || !Number.isSafeInteger(total) || !Array.isArray(rows))
        continue
      if (!total) {
        // A zero result count alone cannot establish coverage of an external drive.
        const covered = await searchEndpoint({ exe, instance: name }, root, '*', 1, signal)
        if (!covered?.length) continue
      }
      return {
        offset: window.offset,
        total,
        rows: rows.slice(0, window.limit).map((row) => (indexedEntry(row) ? row : null))
      }
    } catch {
      if (signal.aborted) return null
    }
  }
  return null
}

/** Null means unavailable or unindexed. Empty answers in indexed roots stay fast. */
export async function searchEverythingBrowse(
  root: string,
  query: string,
  maxHits: number,
  signal: AbortSignal
): Promise<IndexedEntry[] | null> {
  for await (const endpoint of queryEndpoints(root, signal)) {
    const rows = await searchEndpoint(endpoint, root, query, maxHits, signal)
    if (rows !== null) return rows
  }
  return null
}

async function searchEndpoint(
  { exe, instance: name }: IndexerEndpoint,
  root: string,
  query: string,
  maxHits: number,
  signal: AbortSignal
): Promise<IndexedEntry[] | null> {
  const args = [
    '-json',
    '-attributes',
    '-size',
    '-date-modified',
    '-n',
    String(maxHits + 1),
    '-sort',
    'name-ascending',
    '-path',
    root,
    '-search*',
    `<${nativeBrowseQuery(query)}>`
  ]
  const managed = managedIndexerRuntime()
  let instance: string[] = name ? ['-instance', name] : []
  const request = async (args: string[]): Promise<IndexedEntry[]> => {
    try {
      return await run(exe, [...instance, ...args], signal)
    } catch (error) {
      if (signal.aborted || (error as { code?: number }).code !== 8 || instance.length || managed)
        throw error
      instance = ['-instance', '1.5a']
      return run(exe, [...instance, ...args], signal)
    }
  }
  try {
    const rows = await request(args)
    const directory = resolve(root).toLowerCase()
    const key = `${exe}|${name}|${directory}`
    const prefix = directory.endsWith(sep) ? directory : directory + sep
    const underRoot = (entry: IndexedEntry): boolean =>
      resolve(entry.filename).toLowerCase().startsWith(prefix)
    const covered = (indexedRoots.get(key) ?? 0) > Date.now() || rows.some(underRoot)
    // A running Everything service need not index removable or network drives.
    // Probe coverage once per location instead of mistaking that for no matches.
    if (!covered) {
      const probe = await request([
        '-json',
        '-attributes',
        '-n',
        '1',
        '-path',
        root,
        '-search*',
        '*'
      ])
      if (!probe.some(underRoot)) return null
    }
    indexedRoots.delete(key)
    indexedRoots.set(key, Date.now() + 30000)
    if (indexedRoots.size > 64) indexedRoots.delete(indexedRoots.keys().next().value!)
    return rows
  } catch {
    return null
  }
}
