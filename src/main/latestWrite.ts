import { writeFileSync } from 'fs'
import { rename, rm, writeFile } from 'fs/promises'

/**
 * A small file kept as its NEWEST version, written off the main thread (owner,
 * 2026-10-12: the 3.9 s tabs.json freeze). Used by the tab strip and the window
 * state, which both save on a debounce while the user works.
 *
 * One write is in flight at a time. A write asked for while one runs replaces
 * whatever was still waiting, and the loop writes that next, so the newest
 * always lands last: two writes racing their renames could otherwise leave the
 * older one on disk. Each write goes to a tmp file and is swapped in with a
 * rename, so a crash mid-write leaves the old file whole. `flushSync` is the
 * quit path: it writes at once, drops anything waiting, and a write already in
 * flight drops its rename. A failed write is quiet: a viewer that cannot save
 * its tab strip or window size is still a viewer.
 */
export function latestWriter(path: () => string): {
  /** Resolves once this text (or a newer one) has been written or given up on. */
  write: (text: string) => Promise<void>
  flushSync: (text: string) => void
} {
  let pending: string | null = null
  let running: Promise<void> | null = null
  let flushes = 0

  async function drain(): Promise<void> {
    // Always yield first, so `running` is set before this can finish and clear it.
    await Promise.resolve()
    try {
      while (pending !== null) {
        const text = pending
        pending = null
        const seen = flushes
        let tmp: string | null = null
        try {
          const target = path()
          tmp = `${target}.tmp`
          await writeFile(tmp, text)
          // A quit flush landed while this was writing: it is newer, keep it.
          if (seen !== flushes) await rm(tmp, { force: true })
          else await rename(tmp, target)
        } catch {
          if (tmp) await rm(tmp, { force: true }).catch(() => {})
        }
      }
    } finally {
      running = null
    }
  }

  return {
    write(text) {
      pending = text
      if (!running) running = drain()
      return running
    },
    // sync-ok: the quit flush, called only at window close or quit
    flushSync(text) {
      flushes += 1
      pending = null
      try {
        writeFileSync(path(), text) // sync-ok: quit flush, the last state must be down before exit
      } catch {
        /* a viewer that cannot write its state is still a viewer */
      }
    }
  }
}
