import { access, rm, writeFile } from 'fs/promises'
import {
  installVerb,
  recommandVerb,
  relabelVerb,
  removeVerb,
  verbInstalled,
  verbRegistered
} from './shellVerb'

interface Dependencies {
  saidNo: () => Promise<boolean>
  remember: (on: boolean) => Promise<void>
  registered: () => Promise<boolean>
  installed: () => Promise<boolean>
  install: () => Promise<boolean>
  remove: () => Promise<boolean>
  relabel: () => Promise<boolean>
  recommand: () => Promise<boolean>
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
    remove: () => removeVerb(),
    relabel: () => relabelVerb(options.exe),
    recommand: () => recommandVerb(options.exe)
  }
  // Whether this launch has already settled what the labels say. Settings asks
  // for the status every time its page opens, and a relabel check is six
  // reg.exe spawns to learn what the first one decided.
  let labelsSettled = false
  let pending: Promise<boolean> = Promise.resolve(false)
  const enqueue = (action: () => Promise<boolean>): Promise<boolean> => {
    const result = pending.then(action).catch(() => false)
    pending = result
    return result
  }
  return {
    status: () =>
      enqueue(async () => {
        if (await deps.registered()) {
          // RELABEL AN EXISTING INSTALL (2026-09-19, #167). The labels became
          // "Open file" and "Open as project", and a working verb is otherwise
          // left alone, so a registration that survives into this build (an
          // upgrade whose uninstaller was skipped, an exe replaced in place)
          // would keep the old text for ever. An ordinary upgrade does not
          // come through here: its uninstaller deleted the keys, and the
          // install below writes them back with the current words. Only
          // where the startup repair itself may write: never in dev, under
          // --e2e or from a preview (`automatic`), and never for somebody who
          // said no, even if keys are somehow still there. `relabelVerb` holds
          // the other half of the rule: on, THIS exe, label only. It runs
          // inside the queue, so an explicit off cannot race it. A failure is
          // swallowed: the switch reports what the REGISTRY says, and an old
          // label on a working verb is still a verb that is on.
          //
          // AND ITS COMMAND (2026-09-20, #167): "Open file" asks for the
          // Explorer tab through a switch in its command, and the same
          // survivors would keep the command that makes a project. Same gate,
          // same launch, same queue, and `recommandVerb` holds the same narrow
          // rule. Each is tried on its own, so a label that could not be
          // written does not cost the command its turn.
          if (options.automatic && !labelsSettled) {
            labelsSettled = true
            if (!(await deps.saidNo().catch(() => true))) {
              await deps.relabel().catch(() => false)
              await deps.recommand().catch(() => false)
            }
          }
          return true
        }
        if (!options.automatic || (await deps.saidNo())) return false
        // Preserve a working registration owned by another installed copy.
        // What install writes carries the current labels by construction.
        labelsSettled = true
        return (await deps.install()) && (await deps.installed())
      }),
    set: (on) =>
      enqueue(async () => {
        // Do not report a durable preference when saving it failed.
        await deps.remember(on)
        if (!on) return (await deps.remove()) && !(await deps.registered())
        labelsSettled = true
        return (await deps.install()) && (await deps.installed())
      })
  }
}
