import { renameSync, writeFileSync } from 'fs'
import { rm, writeFile } from 'fs/promises'

/**
 * WRITE A FILE ALL AT ONCE OR NOT AT ALL (code review 2026-09-24, #18).
 * `writeFileSync` truncates and then writes, and the app flushes tabs.json at
 * the moments it is most likely to be killed: on close, on quit, at Windows'
 * session end. A power cut between the two left a short or empty file, and
 * every tab and every agent resume with it. So the data goes to a sibling
 * `.tmp` first and is renamed over the real file, which Windows does in one
 * step: the file is always the old one or the new one, never half of either.
 */
export function writeAtomic(file: string, data: string): void {
  const tmp = `${file}.tmp`
  // sync-ok: the all-or-nothing sync write, for startup and quit callers; the live path is createAtomicWriter
  writeFileSync(tmp, data)
  // sync-ok: the all-or-nothing sync write, for startup and quit callers; the live path is createAtomicWriter
  renameSync(tmp, file)
}

/**
 * THE SAME, OFF THE MAIN THREAD, for the saves made while the app runs
 * (owner, 2026-10-15: "heavy stalls ... up to 5-10 seconds"). MEASURED in
 * Stable's diag log that morning: with the disk starved machine-wide (the
 * fs canary 1 to 7 s), main stalled 3 to 6 s with no IPC around it, and the
 * page with it, while Prism, writing less, barely did. `writeFileSync` on
 * main waits for the disk; here the data goes to the `.tmp` on the
 * threadpool, and only the rename, which is all-or-nothing, runs on main.
 *
 * `save` is debounce-friendly: one write at a time, and a save made while one
 * is on its way replaces any other waiting, so only the newest is written
 * next. `saveNow` is the synchronous write for the close and the quit (rule
 * 7: they are the moments the process ends). Every write has a number, and a
 * rename happens only when nothing newer has landed: a slow async write that
 * finishes after `saveNow` leaves the newer file alone.
 */
export interface AtomicWriter {
  save(data: string): void
  saveNow(data: string): void
  /** For tests: settles when the async writes have. */
  idle(): Promise<void>
}

export function createAtomicWriter(file: string): AtomicWriter {
  const tmp = `${file}.tmp`
  const nowTmp = `${file}.now.tmp`
  let seq = 0
  let landed = 0
  let next: { data: string; n: number } | null = null
  let running: Promise<void> | null = null
  const run = async (): Promise<void> => {
    while (next) {
      const job = next
      next = null
      try {
        await writeFile(tmp, job.data)
        if (job.n > landed) {
          // sync-ok: one rename, all-or-nothing, kept on main so it is ordered against saveNow (the data went out on the threadpool)
          renameSync(tmp, file)
          landed = job.n
        } else await rm(tmp, { force: true })
      } catch {
        /* a lost save is the one before it staying; the next save tries again */
      }
    }
  }
  return {
    save: (data) => {
      next = { data, n: (seq += 1) }
      running ??= run().finally(() => {
        running = null
      })
    },
    saveNow: (data) => {
      const n = (seq += 1)
      next = null
      // sync-ok: saveNow is the close and the quit
      writeFileSync(nowTmp, data)
      // sync-ok: saveNow is the close and the quit
      renameSync(nowTmp, file)
      landed = n
    },
    idle: async () => {
      while (running) await running
    }
  }
}
