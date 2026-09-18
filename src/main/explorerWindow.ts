import { spawn } from 'child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { readdir, rm } from 'fs/promises'
import { basename, dirname, join, resolve } from 'path'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const WINDOWS = 'explorer-windows'
const MARKER = 'prism-window.json'

/** Each extra window owns its Chromium profile, tabs, terminals and desktop grants. */
export function explorerWindowOwner(profile: string, argv: readonly string[]): string | null {
  const id = argv.find((arg) => arg.startsWith('--explorer-window='))?.split('=')[1]
  if (!id || !UUID.test(id) || basename(profile) !== id || basename(dirname(profile)) !== WINDOWS)
    return null
  return dirname(dirname(resolve(profile)))
}

export function explorerWindowArgs(options: {
  owner: string
  id: string
  packaged: boolean
  appPath: string
  argv: readonly string[]
}): { profile: string; args: string[] } {
  if (!UUID.test(options.id)) throw new Error('Invalid Explorer window request')
  const profile = join(resolve(options.owner), WINDOWS, options.id)
  return {
    profile,
    args: [
      ...(!options.packaged ? [options.appPath] : []),
      `--user-data-dir=${profile}`,
      `--explorer-window=${options.id}`,
      `--win-e=${options.id}`,
      ...options.argv.filter((arg) => arg === '--e2e' || arg === '--preview'),
      ...(options.argv.includes('--e2e')
        ? ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1']
        : [])
    ]
  }
}

export function markExplorerWindow(profile: string, closed: boolean): void {
  try {
    writeFileSync(join(profile, MARKER), JSON.stringify({ pid: process.pid, closed }))
  } catch {
    // A missing marker prevents cleanup rather than risking an unknown profile.
  }
}

/** An installer must not bypass another window's unsaved-file/terminal close flow. */
export async function hasOtherExplorerWindows(owner: string): Promise<boolean> {
  const root = join(resolve(owner), WINDOWS)
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const profiles = [
    resolve(owner),
    ...entries
      .filter((item) => item.isDirectory() && !item.isSymbolicLink() && UUID.test(item.name))
      .map((item) => join(root, item.name))
  ]
  for (const profile of profiles) {
    let pid: number
    try {
      const marker = JSON.parse(readFileSync(join(profile, MARKER), 'utf8'))
      if (marker.pid === process.pid) continue
      if (!Number.isSafeInteger(marker.pid) || marker.pid <= 0) return true
      pid = marker.pid
    } catch {
      // A just-created child may not have written its marker yet.
      if (profile !== resolve(owner)) return true
      continue
    }
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return true
    }
  }
  return false
}

/** Only normally closed, owned profiles whose process has exited can be removed. */
export async function cleanExplorerWindows(owner: string): Promise<void> {
  const root = join(resolve(owner), WINDOWS)
  for (const item of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!item.isDirectory() || item.isSymbolicLink() || !UUID.test(item.name)) continue
    const profile = join(root, item.name)
    try {
      const marker = JSON.parse(readFileSync(join(profile, MARKER), 'utf8'))
      if (marker.closed !== true || !Number.isSafeInteger(marker.pid) || marker.pid <= 0) continue
      try {
        process.kill(marker.pid, 0)
        continue
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') continue
      }
      if (dirname(resolve(profile)) === root) await rm(profile, { recursive: true, force: true })
    } catch {
      // Keep crashed/incomplete sessions and profiles still locked by Chromium.
    }
  }
}

export function launchExplorerWindow(
  options: Parameters<typeof explorerWindowArgs>[0] & {
    executable: string
  }
): void {
  const { profile, args } = explorerWindowArgs(options)
  mkdirSync(dirname(profile), { recursive: true })
  try {
    // Request tokens are unique; a retransmitted token must not launch twice.
    mkdirSync(profile)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return
    throw error
  }
  let child: ReturnType<typeof spawn>
  try {
    child = spawn(options.executable, args, { detached: true, stdio: 'ignore' })
  } catch (error) {
    markExplorerWindow(profile, true)
    throw error
  }
  // Never ACK from the old window. The new renderer acknowledges its own readiness;
  // launch failure or timeout leaves the helper's Windows Explorer fallback intact.
  child.on('spawn', () => {
    try {
      writeFileSync(join(profile, MARKER), JSON.stringify({ pid: child.pid, closed: false }), {
        flag: 'wx'
      })
    } catch {
      /* The child may already have written its own marker. */
    }
  })
  child.on('error', () => markExplorerWindow(profile, true))
  child.on('exit', () => void cleanExplorerWindows(options.owner))
  child.unref()
}
