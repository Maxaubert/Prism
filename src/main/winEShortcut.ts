import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { promisify } from 'util'
import type { WinEShortcutStatus } from '@shared/winEShortcut'

const exec = promisify(execFile)
type Runner = (file: string, args: string[]) => Promise<string>
const run: Runner = async (file, args) => {
  try {
    return (await exec(file, args, { windowsHide: true, timeout: 15000, maxBuffer: 64 * 1024 }))
      .stdout
  } catch (error) {
    // The helper returns current state with an error even on a nonzero exit.
    const stdout = (error as { stdout?: unknown }).stdout
    if (typeof stdout === 'string' && stdout.trim()) return stdout
    throw error
  }
}

/** The native helper owns its registry entry. Never edit Explorer associations. */
export function createWinEShortcut(options: {
  helper: string
  executable: string
  profile: string
  supported: boolean
  runner?: Runner
  exists?: (path: string) => boolean
}): {
  status: () => Promise<WinEShortcutStatus>
  set: (on: boolean) => Promise<WinEShortcutStatus>
  resume: () => Promise<void>
} {
  const empty = { enabled: false, running: false, conflict: false }
  let lastKnown = empty
  const command = async (verb: string): Promise<WinEShortcutStatus> => {
    if (!options.supported || !(options.exists ?? existsSync)(options.helper))
      return { ...empty, available: false, error: 'Available in packaged Windows builds of Prism.' }
    try {
      const raw = JSON.parse(
        await (options.runner ?? run)(options.helper, [verb, options.executable, options.profile])
      )
      if (!raw || ['enabled', 'running', 'conflict'].some((key) => typeof raw[key] !== 'boolean'))
        throw new Error('Invalid helper reply')
      lastKnown = { enabled: raw.enabled, running: raw.running, conflict: raw.conflict }
      return {
        available: true,
        enabled: raw.enabled,
        running: raw.running,
        conflict: raw.conflict,
        ...(typeof raw.error === 'string' && raw.error ? { error: raw.error.slice(0, 500) } : {})
      }
    } catch {
      return {
        ...lastKnown,
        available: true,
        error: 'Windows could not confirm the shortcut state. Try again.'
      }
    }
  }
  // Two quick clicks must not leave a late Enable running after Disable.
  let changes: Promise<unknown> = Promise.resolve()
  const set = (on: boolean): Promise<WinEShortcutStatus> => {
    const next = changes.then(async () => {
      const result = await command(on ? '--enable' : '--disable')
      if (!result.available) return result
      const verified = await command('--status')
      if (result.error) return { ...verified, error: result.error }
      if (!verified.error && (verified.enabled !== on || (on && !verified.running)))
        return { ...verified, error: 'The shortcut change could not be confirmed. Try again.' }
      return verified
    })
    changes = next
    return next
  }
  return {
    status: () => command('--status'),
    set,
    resume: async () => {
      const state = await command('--status')
      if (state.enabled && !state.running && !state.conflict && !state.error) await set(true)
    }
  }
}
