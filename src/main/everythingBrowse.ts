import { execFile } from 'child_process'
import { findEverything } from './everything'
import { nativeBrowseQuery } from '@shared/browseQuery'
import { resolve, sep } from 'path'

const indexedRoots = new Map<string, number>()
export function clearEverythingBrowseCache(): void {
  indexedRoots.clear()
}

export interface IndexedEntry {
  filename: string
  attributes: number
  size?: number
  date_modified?: number
}

function run(exe: string, args: string[], signal: AbortSignal): Promise<IndexedEntry[]> {
  return new Promise((resolve, reject) => {
    execFile(
      exe,
      args,
      { windowsHide: true, signal, timeout: 2000, maxBuffer: 4 * 1024 * 1024 },
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
  const exe = await findEverything()
  if (!exe || signal.aborted) return null
  // -search consumes one normal argv value. Positional queries preserve the
  // CLI's surrounding quotes and can accidentally be interpreted as switches.
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
    '-search',
    `<${nativeBrowseQuery(query)}>`
  ]
  let instance: string[] = []
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
        '-search',
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
