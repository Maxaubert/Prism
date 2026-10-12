import { randomUUID } from 'crypto'
import { renameSync, rmSync, writeFileSync } from 'fs'
import { rename, rm, writeFile } from 'fs/promises'

/**
 * One file written whole or not at all: the text goes to a tmp file beside it
 * (or at `tmp`) that a rename swaps in, so a crash mid-write leaves the old
 * file whole. Every state file goes through here or `latestWriter` (structure
 * cleanup, 2026-10-12).
 *
 * `keep` is asked after the write, before the rename: a caller whose write went
 * stale meanwhile (a Clear, a quit flush, a newer value) answers false and the
 * tmp file is dropped instead. The tmp file never outlives the call. Resolves
 * true when the file was swapped in; a failure throws, for the caller to judge.
 */
export async function writeAtomic(
  target: string,
  text: string,
  opts: { tmp?: string; keep?: () => boolean } = {}
): Promise<boolean> {
  const tmp = opts.tmp ?? `${target}.${randomUUID()}.tmp`
  try {
    await writeFile(tmp, text, 'utf8')
    if (opts.keep && !opts.keep()) return false
    await rename(tmp, target)
    return true
  } finally {
    await rm(tmp, { force: true }).catch(() => {})
  }
}

/** `writeAtomic` for the quit flush, where the process is going and nothing is
 *  left to wait for. Throws on a failure, for the caller to judge. */
// sync-ok: quit flush only, every caller marks its own call
export function writeAtomicSync(target: string, text: string, tmp = `${target}.${randomUUID()}.tmp`): void {
  try {
    writeFileSync(tmp, text, 'utf8') // sync-ok: quit flush
    renameSync(tmp, target) // sync-ok: quit flush
  } finally {
    try {
      rmSync(tmp, { force: true }) // sync-ok: quit flush
    } catch {
      /* a stray tmp file is harmless */
    }
  }
}

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
 * quit path: it writes at once (through its own tmp file, so it is atomic
 * too), drops anything waiting, and a write already in flight drops its
 * rename. A failed write is quiet: a viewer that cannot save
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
        try {
          const target = path()
          // A quit flush landed while this was writing: it is newer, keep it.
          await writeAtomic(target, text, { tmp: `${target}.tmp`, keep: () => seen === flushes })
        } catch {
          /* a failed write is quiet */
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
        writeAtomicSync(path(), text) // sync-ok: quit flush, the last state must be down before exit
      } catch {
        /* a viewer that cannot write its state is still a viewer */
      }
    }
  }
}
