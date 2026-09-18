import { execFile } from 'child_process'
import { findEverything } from './everything'
import { nativeBrowseQuery } from '@shared/browseQuery'
import { dirname, resolve, sep } from 'path'
import { managedIndexerRuntime } from './indexerRuntime'

const indexedRoots = new Map<string, number>()
export function clearEverythingBrowseCache(): void {
  indexedRoots.clear()
}

/** Indexed totals cover indexed descendants; callers label them as indexed estimates. */
export async function getIndexedFolderSizes(
  paths: readonly string[],
  signal: AbortSignal = new AbortController().signal
): Promise<Map<string, { bytes: number }> | null> {
  if (!paths.length) return new Map()
  if (signal.aborted) return null
  const exe = await findEverything(dirname(paths[0]))
  if (!exe || signal.aborted) return null
  const managed = managedIndexerRuntime()
  const instance = managed ? ['-instance', managed.endpoint.instance] : []
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

function run(exe: string, args: string[], signal: AbortSignal): Promise<IndexedEntry[]> {
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
        try {
          const rows: unknown = JSON.parse(output || '[]')
          if (!Array.isArray(rows)) throw new Error('Invalid Everything response')
          resolve(
            rows.filter(
              (row): row is IndexedEntry =>
                !!row && typeof row.filename === 'string' && typeof row.attributes === 'number'
            )
          )
        } catch (error) {
          reject(error)
        }
      }
    )
  })
}

/** Null means unavailable or unindexed. Empty answers in indexed roots stay fast. */
export async function searchEverythingBrowse(
  root: string,
  query: string,
  maxHits: number,
  signal: AbortSignal
): Promise<IndexedEntry[] | null> {
  const exe = await findEverything(root)
  if (!exe || signal.aborted) return null
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
  let instance: string[] = managed ? ['-instance', managed.endpoint.instance] : []
  const request = async (args: string[]): Promise<IndexedEntry[]> => {
    try {
      return await run(exe, [...instance, ...args], signal)
    } catch (error) {
      if (signal.aborted || (error as { code?: number }).code !== 8 || instance.length) throw error
      instance = ['-instance', '1.5a']
      return run(exe, [...instance, ...args], signal)
    }
  }
  try {
    const rows = await request(args)
    const key = resolve(root).toLowerCase()
    const prefix = key.endsWith(sep) ? key : key + sep
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
