import { access, rm, writeFile } from 'fs/promises'
import { installVerb, removeVerb, verbInstalled, verbRegistered } from './shellVerb'

interface Dependencies {
  saidNo: () => Promise<boolean>
  remember: (on: boolean) => Promise<void>
  registered: () => Promise<boolean>
  installed: () => Promise<boolean>
  install: () => Promise<boolean>
  remove: () => Promise<boolean>
}

/** Startup repair, status and explicit changes share one queue. */
export function createShellVerbSetting(
  options: { exe: string; marker: string; automatic: boolean },
  dependencies?: Dependencies
): { status: () => Promise<boolean>; set: (on: boolean) => Promise<boolean> } {
  const deps: Dependencies = dependencies ?? {
    saidNo: async () => {
      try {
        await access(options.marker)
        return true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
        throw error
      }
    },
    remember: (on) =>
      on
        ? rm(options.marker, { force: true })
        : writeFile(options.marker, new Date().toISOString()),
    registered: () => verbRegistered(),
    installed: () => verbInstalled(options.exe),
    install: () => installVerb(options.exe),
    remove: () => removeVerb()
  }
  let pending: Promise<boolean> = Promise.resolve(false)
  const enqueue = (action: () => Promise<boolean>): Promise<boolean> => {
    const result = pending.then(action).catch(() => false)
    pending = result
    return result
  }
  return {
    status: () =>
      enqueue(async () => {
        if (await deps.registered()) return true
        if (!options.automatic || (await deps.saidNo())) return false
        // Preserve a working registration owned by another installed copy.
        return (await deps.install()) && (await deps.installed())
      }),
    set: (on) =>
      enqueue(async () => {
        // Do not report a durable preference when saving it failed.
        await deps.remember(on)
        if (on) return (await deps.install()) && (await deps.installed())
        return (await deps.remove()) && !(await deps.registered())
      })
  }
}
