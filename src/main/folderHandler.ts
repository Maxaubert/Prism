import { existsSync } from 'fs'
import { access, rm, writeFile } from 'fs/promises'
import { run as runOffMain } from './spawnWorker'
import type { FolderHandlerStatus } from '@shared/folderHandler'

/**
 * OPEN FOLDERS IN PRISM (#393; owner, 2026-10-15). Off by default.
 *
 * Windows' default verb for Directory and Drive, per user, so a folder any app
 * opens (Run, cmd, a shortcut, Prism Terminal) opens in Prism's Explorer.
 * File Explorer's own double-clicks stay in File Explorer: the verb is
 * `ProgrammaticAccessOnly` (owner's choice the same day). Files are untouched.
 *
 * The native helper owns the registry, as it owns Win+E: reg.exe prints an
 * unset default as a LOCALISED placeholder, so "was there a default before?",
 * which turning off must answer exactly, cannot be read from it. The verb runs
 * a copy of the helper kept outside the install folder, which opens File
 * Explorer for anything short of Prism's acknowledgement. Measured routes and
 * the design: docs/superpowers/specs/2026-10-15-folder-handler-design.md.
 */
type Runner = (file: string, args: string[]) => Promise<string>
const run: Runner = async (file, args) => {
  try {
    return (await runOffMain(file, args, { windowsHide: true, timeout: 15000, maxBuffer: 64 * 1024 })).stdout
  } catch (error) {
    // The helper prints the state it left, with its error, on a nonzero exit.
    const stdout = (error as { stdout?: unknown }).stdout
    if (typeof stdout === 'string' && stdout.trim()) return stdout
    throw error
  }
}

interface Options {
  helper: string
  executable: string
  profile: string
  /** Packaged Windows builds only: never dev, never under --e2e. */
  supported: boolean
  /** userData file whose presence says the user turned it ON: the one fact
   *  worth storing, so an upgrade's old uninstaller cannot turn it off. */
  marker: string
  runner?: Runner
  exists?: (path: string) => boolean
}

export function createFolderHandler(options: Options): {
  status: () => Promise<FolderHandlerStatus>
  set: (on: boolean) => Promise<FolderHandlerStatus>
  repair: () => Promise<void>
} {
  const unavailable: FolderHandlerStatus = {
    available: false,
    on: false,
    mine: false,
    error: 'Available in packaged Windows builds of Prism.'
  }
  const command = async (verb: string): Promise<FolderHandlerStatus> => {
    if (!options.supported || !(options.exists ?? existsSync)(options.helper)) return unavailable
    const args = verb === '--folders-disable' ? [verb] : [verb, options.executable, options.profile]
    try {
      const raw = JSON.parse(await (options.runner ?? run)(options.helper, args))
      if (!raw || typeof raw.on !== 'boolean' || typeof raw.current !== 'boolean')
        throw new Error('Invalid helper reply')
      return {
        available: true,
        on: raw.on,
        mine: raw.on && raw.current,
        ...(typeof raw.error === 'string' && raw.error ? { error: raw.error.slice(0, 500) } : {})
      }
    } catch {
      return { available: true, on: false, mine: false, error: 'Windows could not confirm the folder setting.' }
    }
  }
  const chosen = async (): Promise<boolean> => {
    try {
      await access(options.marker)
      return true
    } catch {
      return false
    }
  }
  // Two quick clicks must not leave a late On running after Off.
  let changes: Promise<unknown> = Promise.resolve()
  const queue = <T>(action: () => Promise<T>): Promise<T> => {
    const next = changes.then(action, action)
    changes = next.catch(() => undefined)
    return next
  }
  return {
    status: () => queue(() => command('--folders-status')),
    set: (on) =>
      queue(async () => {
        if (!options.supported) return unavailable
        // Do not report a durable choice when saving it failed.
        if (on) await writeFile(options.marker, new Date().toISOString())
        else await rm(options.marker, { force: true })
        const result = await command(on ? '--folders-enable' : '--folders-disable')
        if (result.error) return result
        const verified = await command('--folders-status')
        if (!verified.error && (on ? !verified.mine : verified.on))
          return { ...verified, error: 'The folder setting could not be confirmed.' }
        return verified
      }),
    // STARTUP REPAIR: an upgrade runs the old uninstaller, which keeps the
    // registration, but a build in a new place, a new profile or a copy left
    // from an older helper all leave it pointing elsewhere. Only for somebody
    // who turned it on; without the marker nothing is ever written.
    repair: () =>
      queue(async () => {
        if (!options.supported || !(await chosen())) return
        const state = await command('--folders-status')
        if (!state.error && !state.mine) await command('--folders-enable')
      })
  }
}
