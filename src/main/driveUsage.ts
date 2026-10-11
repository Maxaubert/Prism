import { statfs } from 'fs/promises'
import { join } from 'path'
import { Worker } from 'worker_threads'
import type { BrowseDriveUsage } from '@shared/browse'

/**
 * HOW FULL EACH DRIVE IS, for the Explorer's This PC rows (#296; owner,
 * 2026-10-06: "the disks with a bar showing off how much is in use").
 *
 * Sizes come from `statfs`, one call per drive on libuv's pool, never a
 * shell. A drive that does not answer in STATFS_WAIT (a sleeping network
 * share, a card pulled mid-call) answers with no sizes, and while its call is
 * still out it is not asked again: a stalled call holds one of the pool's
 * four threads, and asking every refresh would take them all.
 *
 * The names ("Data", "USB Drive") need the volume label, which no Node call
 * gives. One PowerShell CIM query reads every drive's label and type at once;
 * it runs only when the set of drives changes or LABEL_TTL has passed, never
 * per refresh, and the sizes never wait on it longer than LABEL_WAIT.
 */

export const STATFS_WAIT = 1500
export const LABEL_WAIT = 4000
export const LABEL_TTL = 10 * 60_000

type Space = { total: number; free: number }
type Label = { label: string; kind: NonNullable<BrowseDriveUsage['kind']> }

export interface DriveUsageDeps {
  space: (root: string) => Promise<Space>
  labels: () => Promise<Map<string, Label>>
  now: () => number
  /** The drive Windows runs from, `C:`, for the Windows badge on its row. */
  systemDrive?: () => string | undefined
}

const ROOT = /^[A-Z]:\\$/i

/** Win32_LogicalDisk's DriveType: 2 removable, 3 local, 4 network, 5 optical. */
export function driveKind(type: number): Label['kind'] {
  return type === 2 ? 'removable' : type === 4 ? 'network' : type === 5 ? 'optical' : 'local'
}

/** `C:|3|Windows` lines, one per drive, into a map keyed `C:\`. */
export function parseLabels(output: string): Map<string, Label> {
  const found = new Map<string, Label>()
  for (const line of output.split(/\r?\n/)) {
    const m = /^([A-Z]):\|(\d*)\|(.*)$/i.exec(line.trim())
    if (!m) continue
    found.set(`${m[1].toUpperCase()}:\\`, { label: m[3].trim(), kind: driveKind(Number(m[2])) })
  }
  return found
}

const powershell = (): string =>
  join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

/** UTF-8 first: piped, Windows PowerShell writes in the console's OEM code
 *  page, so a label like "Søren" reached the page as "S?ren" (MEASURED,
 *  "Dataøæ" came back as two replacement characters). */
export const LABEL_COMMAND =
  '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ' +
  'Get-CimInstance Win32_LogicalDisk | ForEach-Object { $_.DeviceID + "|" + $_.DriveType + "|" + $_.VolumeName }'

/**
 * THE QUERY IS SPAWNED FROM A WORKER THREAD, NOT MAIN'S (#351). Starting a
 * process is synchronous on the thread that starts it, and now and then it
 * took main's whole event loop for three seconds (MEASURED in the diagnostics
 * log: `main-lag` 2.95 to 3.25 s with only `browse:drives` in flight, about
 * every four hours, against 550 ms for the query on every other refresh). A
 * worker pays that wait on its own thread; main only hears the answer.
 */
const LABEL_WORKER = `
const { parentPort, workerData } = require('worker_threads')
const { execFile } = require('child_process')
execFile(workerData.exe, workerData.args, { windowsHide: true, timeout: 10000 }, (error, stdout) =>
  parentPort.postMessage(error ? null : String(stdout))
)
`

export function readLabels(): Promise<Map<string, Label>> {
  if (process.platform !== 'win32') return Promise.resolve(new Map())
  return new Promise((resolve) => {
    let worker: Worker
    try {
      worker = new Worker(LABEL_WORKER, {
        eval: true,
        workerData: { exe: powershell(), args: ['-NoProfile', '-NonInteractive', '-Command', LABEL_COMMAND] }
      })
    } catch {
      resolve(new Map())
      return
    }
    let answered = false
    const answer = (stdout: string | null): void => {
      if (answered) return
      answered = true
      resolve(stdout === null ? new Map() : parseLabels(stdout))
      void worker.terminate()
    }
    worker.once('message', (stdout: string | null) => answer(stdout))
    worker.once('error', () => answer(null))
    worker.once('exit', () => answer(null))
  })
}

async function readSpace(root: string): Promise<Space> {
  const s = await statfs(root)
  return { total: s.blocks * s.bsize, free: s.bavail * s.bsize }
}

const defaults: DriveUsageDeps = {
  space: readSpace,
  labels: readLabels,
  now: Date.now,
  systemDrive: () => process.env.SystemDrive
}

const within = <T>(work: Promise<T>, ms: number): Promise<T | undefined> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(undefined)
      }
    )
  })

export function createDriveUsage(deps: DriveUsageDeps = defaults) {
  const pending = new Map<string, Promise<Space>>()
  let labels: { at: number; set: string; read: Promise<Map<string, Label>> } | null = null

  const labelsFor = (roots: string[]): Promise<Map<string, Label>> => {
    const set = roots.join('|')
    if (!labels || labels.set !== set || deps.now() - labels.at > LABEL_TTL) {
      labels = { at: deps.now(), set, read: deps.labels().catch(() => new Map()) }
    }
    return labels.read
  }

  const spaceOf = (root: string): Promise<Space | undefined> => {
    // Still out from an earlier refresh: this drive is not answering, so
    // it is not asked again until that call has come back.
    if (pending.has(root)) return Promise.resolve(undefined)
    const call = deps.space(root)
    pending.set(root, call)
    const done = (): void => {
      if (pending.get(root) === call) pending.delete(root)
    }
    call.then(done, done)
    return within(call, STATFS_WAIT)
  }

  return async function driveUsage(paths: unknown): Promise<BrowseDriveUsage[]> {
    if (!Array.isArray(paths)) return []
    const roots = [
      ...new Set(
        paths
          .filter((p): p is string => typeof p === 'string' && ROOT.test(p))
          .map((p) => p.toUpperCase())
      )
    ].slice(0, 26)
    const system = /^([A-Z]):\\?$/i.exec(deps.systemDrive?.() ?? '')?.[1]?.toUpperCase()
    const [names, spaces] = await Promise.all([
      within(labelsFor(roots), LABEL_WAIT),
      Promise.all(roots.map(spaceOf))
    ])
    return roots.map((path, i) => {
      const space = spaces[i]
      const name = names?.get(path)
      const ok = !!space && Number.isFinite(space.total) && space.total > 0
      return {
        path,
        ...(name ? { label: name.label, kind: name.kind } : {}),
        ...(system && path === `${system}:\\` ? { system: true } : {}),
        ...(ok ? { total: space.total, free: Math.min(Math.max(space.free, 0), space.total) } : {})
      }
    })
  }
}

export const driveUsage = createDriveUsage()

/**
 * Under `--e2e` only: `PRISM_E2E_DRIVE_USED` (a share, 0 to 1) puts the
 * system drive at that much used, so the sidebar's warning from 90% can be
 * seen on a machine whose drives are not that full. The total stays real.
 */
export function withUsedShare(drives: BrowseDriveUsage[], share: string | undefined): BrowseDriveUsage[] {
  const used = Number(share)
  if (!share || !Number.isFinite(used) || used < 0 || used > 1) return drives
  return drives.map((d) => (d.system && d.total !== undefined ? { ...d, free: d.total * (1 - used) } : d))
}
