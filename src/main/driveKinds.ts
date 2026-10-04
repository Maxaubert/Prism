import { execFile } from 'child_process'

/**
 * WHICH DRIVES ARE THIS PC'S OWN DISKS (#271). The listing cache and the read
 * ahead touch local fixed drives only (owner's approved recommendation,
 * 2026-10-04: "never for network or removable drives"; "local fixed drives
 * only"). A network share can stall a read for seconds, and a removable drive
 * may be asleep or gone, and file names from a stick the user unplugged have
 * no business sitting in %APPDATA%.
 *
 * Windows' own answer is GetDriveType, which Node does not expose, so the
 * kinds are asked once, AFTER the first listing, from WMI (Win32_LogicalDisk:
 * 2 removable, 3 local fixed, 4 network, 5 optical). Until that answer only
 * the system drive counts as fixed, which is where home, Desktop, Documents and
 * Downloads live on a fresh install, so the first launch is covered too.
 */

export type DriveKind = 'fixed' | 'other' | 'unknown'

/** `C:` from a path, or null for a UNC path, a device path or a relative one. */
export function driveOf(path: string): string | null {
  const m = /^([a-zA-Z]):(?:[\\/]|$)/.exec(path)
  return m ? `${m[1].toUpperCase()}:` : null
}

/** Pure: what `path` sits on, given the drive kinds known so far. */
export function driveKindOf(
  path: string,
  kinds: ReadonlyMap<string, number>,
  systemDrive: string | undefined
): DriveKind {
  if (path.startsWith('\\\\') || path.startsWith('//')) return 'other'
  const drive = driveOf(path)
  if (!drive) return 'other'
  const known = kinds.get(drive)
  if (known !== undefined) return known === 3 ? 'fixed' : 'other'
  if (systemDrive && driveOf(`${systemDrive}\\`) === drive) return 'fixed'
  return 'unknown'
}

/** Pure: WMI's "C:=3" lines into a map, ignoring anything else. */
export function parseDriveKinds(text: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z]):=(\d)$/.exec(line.trim())
    if (m) out.set(`${m[1].toUpperCase()}:`, Number(m[2]))
  }
  return out
}

let kinds = new Map<string, number>()
let asked: Promise<void> | null = null

/** Ask Windows once. Hidden, no stdin, after the first frame by construction
 *  (called from the deferred start-up work), and a failure keeps the
 *  system-drive-only answer, which is the safe one. */
export function learnDriveKinds(): Promise<void> {
  if (asked || process.platform !== 'win32') return asked ?? Promise.resolve()
  asked = new Promise<void>((done) => {
    const child = execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_LogicalDisk | ForEach-Object { "$($_.DeviceID)=$($_.DriveType)" }'
      ],
      { windowsHide: true, timeout: 15_000 },
      (error, stdout) => {
        if (!error) kinds = parseDriveKinds(String(stdout))
        done()
      }
    )
    child.stdin?.end()
  })
  return asked
}

/** True only for a local fixed drive: what the cache and the read ahead may touch. */
export function isLocalFixed(path: string): boolean {
  return driveKindOf(path, kinds, process.env.SystemDrive) === 'fixed'
}
