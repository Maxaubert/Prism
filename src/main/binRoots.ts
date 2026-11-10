import { access } from 'fs/promises'
import { isAbsolute, join, parse } from 'path'
import { isLocalFixed } from './driveKinds'
import { execFile } from './spawnWorker'

/**
 * WHERE THE RECYCLE BINS ARE (Recycle Bin feature, stage 0). Every reader of
 * the bin (undo's restore, the bin view) asks here, so the e2e seam is ONE
 * place: with `--e2e` and `PRISM_E2E_BIN_DIRS` (`|`-separated absolute
 * folders, each standing in for one drive's `$Recycle.Bin\<SID>`) the real
 * bin is never read, listed or written. Without `--e2e` the variable is
 * ignored, so a stray environment can never point the app at another folder.
 */

/** The SID out of `whoami /user /fo csv /nh` ("pc\name","S-1-5-..."). */
export function sidOf(out: string): string | null {
  return /"(S-1-[\d-]+)"/.exec(out)?.[1] ?? null
}

let sid: Promise<string | null> | null = null
/** This user's SID, asked once. Null when whoami could not say, and then
 *  every restore goes the shell's way. */
export function ownSid(): Promise<string | null> {
  sid ??= new Promise((resolve) => {
    try {
      const exe = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe')
      execFile(exe, ['/user', '/fo', 'csv', '/nh'], { windowsHide: true, timeout: 5000 }, (error, stdout) =>
        resolve(error ? null : sidOf(String(stdout)))
      )
    } catch {
      resolve(null)
    }
  })
  return sid
}

/** The seam's folders, or null when there is no seam (not `--e2e`, or unset). */
function seamDirs(): string[] | null {
  if (!process.argv.includes('--e2e')) return null
  const raw = process.env.PRISM_E2E_BIN_DIRS
  if (raw === undefined) return null
  return raw.split('|').filter((d) => d && isAbsolute(d))
}

/** Probe a folder, but never wait on a drive that does not answer (1.5 s, as `browseLocations`). */
function there(dir: string): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 1500)
    access(dir).then(
      () => (clearTimeout(timer), resolve(true)),
      () => (clearTimeout(timer), resolve(false))
    )
  })
}

/**
 * THIS USER'S bin folder on every fixed local drive that has one, never
 * another account's (a folder another account could read must not be listed
 * or handed back as ours). A drive with no such folder is simply absent.
 */
export async function binDirs(): Promise<string[]> {
  const seam = seamDirs()
  if (seam) return seam
  const own = await ownSid()
  if (!own) return []
  const found = await Promise.all(
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(async (letter) => {
      const root = `${letter}:\\`
      if (!isLocalFixed(root)) return null
      const dir = join(root, '$Recycle.Bin', own)
      return (await there(dir)) ? dir : null
    })
  )
  return found.filter((d): d is string => d !== null)
}

/** The bin folder(s) for ONE path's drive: restore asks for the bin of the
 *  drive the file was deleted from. No fixed-drive filter and no probe here
 *  (what undo's restore always did); a seam answers with its own folders. */
export async function binDirsFor(path: string): Promise<string[]> {
  const seam = seamDirs()
  if (seam) return seam
  const own = await ownSid()
  return own ? [join(parse(path).root, '$Recycle.Bin', own)] : []
}
