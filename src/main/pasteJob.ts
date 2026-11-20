import { basename, dirname, join, resolve } from 'path'
import { PUSH } from '@shared/channels'
import type { PasteResult } from '@shared/ipcTypes'
import { rename, rm, stat } from './userFs'
import { exists } from './fsUtil'
import { uniqueNameAsync } from './fileOps'
import { moveShapes, type TextShape } from './textFile'
import {
  copyCounted,
  dropPartial,
  isAborted,
  movePct,
  pastesIntoItself,
  pctOf,
  predictNames,
  walkSizes
} from './pasteCopy'
import { endCopies, startCopies } from './copyJobs'

/** At most one progress message this often, ms (paste, restore and bin jobs). */
export const PASTE_TICK_MS = 120

/** What the paste engine needs from the IPC layer (#538 item 15). */
export interface PasteDeps {
  /** Send a progress push to the window that pasted; nobody once it closed. */
  send: (channel: typeof PUSH.pasteProgress, payload: unknown) => void
  /** Tell the wall and the listing that these paths changed. */
  written: (...paths: string[]) => Promise<unknown>
  /** The text shapes a cut carries to its new path. */
  textShape: Map<string, TextShape>
}

/** The paste engine: copy (or, for a cut, move) src into destDir. */
export async function runPaste(
  deps: PasteDeps,
  destDir: string,
  src: string[],
  moving: boolean,
  jobId?: string
): Promise<PasteResult> {
  // The progress goes to the window that pasted (2026-10-29), and to
  // nobody once it has closed (the caller's send).
  const sendToPage = deps.send
  const job = typeof jobId === 'string' ? jobId : ''
  // Cancel (the loading bar, owner 2026-11-09): checked between items, and
  // aborts the file being written (copyCounted).
  const stop = startCopies(job)
  const signal = stop.signal
  // THE LIST SHOWS WHAT IS LANDING (owner, 2026-10-28: "nothing happens and
  // suddenly items just appear"): a copy names each item and the path it
  // is expected at, so the list can draw it as a row with its own bar.
  // The names are picked in order, each apart from the ones before it, and
  // the copy writes to exactly that name (review, 2026-10-28: two sources
  // called readme.md both predicted readme.md, one row hid the other).
  let current = -1
  let itemDone = 0
  const predicted = moving
    ? []
    : await predictNames(
        src.map((s) => basename(s)),
        (name, taken) => uniqueNameAsync(destDir, name, taken)
      )
  const reserved = new Set(predicted.map((n) => n.toLowerCase()))
  if (!moving) {
    const items = await Promise.all(
      src.map(async (s, i) => {
        const isFolder = await stat(s).then(
          (st) => st.isDirectory(),
          () => false
        )
        return { path: join(destDir, predicted[i]), name: predicted[i], isFolder }
      })
    )
    sendToPage(PUSH.pasteProgress, { jobId: job, pct: 0, start: { dir: destDir, items } })
  }
  // Sized AFTER the rows are said (review, 2026-10-28, finding 17): a big
  // folder's walk no longer holds the list empty. lstat, never following a
  // junction (pasteCopy.walkSizes). A move is a rename and sizes nothing.
  const sizes = moving
    ? src.map(() => 0) // only the cross-volume fallback counts bytes
    : await Promise.all(src.map((f) => walkSizes(f, () => signal.aborted).catch(() => 0)))
  const total = sizes.reduce((x, y) => x + y, 0)
  let done = 0
  let lastSent = 0
  // A message at most every PASTE_TICK_MS, bytes and landings alike (review,
  // 2026-10-28: one per landed item, unthrottled, was a message, a store
  // update and a list pass per file of a 3,000-photo paste). Progress on an
  // item says every item before it is through, so a landing skipped here is
  // said by the next message (lib/jobs.ts updateLanding).
  const due = (): boolean => {
    const now = Date.now()
    if (now - lastSent <= PASTE_TICK_MS) return false
    lastSent = now
    return true
  }
  let unsaid = -1
  const count = (): { done: number; total: number } => ({
    done: pasted + failed,
    total: src.length
  })
  const tick = (bytes: number): void => {
    done += bytes
    itemDone += bytes
    if (total > 0 && due()) {
      unsaid = -1
      const size = sizes[current] ?? 0
      sendToPage(PUSH.pasteProgress, {
        jobId: job,
        pct: pctOf(done, total),
        count: count(),
        ...(current >= 0 && size > 0 ? { item: current, itemPct: pctOf(itemDone, size) } : {})
      })
    }
  }
  const sayLanded = (i: number): void =>
    sendToPage(PUSH.pasteProgress, {
      jobId: job,
      pct: total > 0 ? pctOf(done, total) : 100,
      count: count(),
      item: i,
      itemPct: 100
    })
  const landed = (i: number): void => {
    if (moving) {
      if (due())
        sendToPage(PUSH.pasteProgress, {
          jobId: job,
          pct: pctOf(pasted + failed, src.length),
          count: count()
        })
      return
    }
    if (due()) {
      unsaid = -1
      sayLanded(i)
    } else unsaid = i
  }
  let pasted = 0
  let failed = 0
  const paths: string[] = []
  const from: string[] = []
  // Why each one failed, for the `op` line (owner, 2026-11-06): the error's
  // code (ENOENT, EBUSY, EPERM) or what Prism refused.
  const failures: Array<{ name: string; reason: string }> = []
  const failedWith = (s: string, reason: string): void => {
    failed += 1
    failures.push({ name: basename(s), reason })
  }
  let cancelled = false
  for (const [i, s] of src.entries()) {
    if (signal.aborted) {
      cancelled = true
      break
    }
    current = i
    itemDone = 0
    // A folder pasted into itself or below itself is skipped and counted
    // as failed (2026-10-16): it used to copy its own copy until the path
    // ran out, and a cut fell through to the same copy (pasteCopy.ts).
    if (pastesIntoItself(s, destDir)) {
      failedWith(s, 'into itself')
      continue
    }
    // A cut pasted back into its own folder does nothing, like a drag put
    // back down (audit 2026-11-18, #533): it used to rename the item to
    // "name (2)", since its own name was taken by itself.
    if (moving && resolve(dirname(s)).toLowerCase() === resolve(destDir).toLowerCase()) continue
    // What this item has actually started writing, for the clean-up below:
    // a name it never wrote to is not its to remove.
    let writing: string | null = null
    try {
      // The predicted name, unless something took it meanwhile (then the
      // next free one that no other item of this paste is to land under).
      const name =
        predicted[i] && !(await exists(join(destDir, predicted[i])))
          ? predicted[i]
          : await uniqueNameAsync(destDir, basename(s), reserved)
      const target = join(destDir, name)
      if (moving) {
        try {
          await rename(s, target)
        } catch {
          // EXDEV or a lock: counted copy, then the source goes, its share
          // of the job counted in items (pasteCopy.ts movePct).
          const size = await walkSizes(s, () => signal.aborted).catch(() => 0)
          let moved = 0
          writing = target
          await copyCounted(
            s,
            target,
            (b) => {
              moved += b
              if (size > 0 && due())
                sendToPage(PUSH.pasteProgress, {
                  jobId: job,
                  pct: movePct(i, src.length, moved, size),
                  count: count()
                })
            },
            { signal, keep: true }
          )
          writing = null
          // The copy is whole: only now does the source go.
          await rm(s, { recursive: true })
        }
        // A cut carries the text shape like a drag-move does (2026-10-16).
        moveShapes(deps.textShape, s, target)
      } else {
        writing = target
        await copyCounted(s, target, tick, { signal })
        writing = null
      }
      paths.push(target)
      from.push(s)
      pasted += 1
      landed(i)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | null)?.code
      const stopped = isAborted(err, signal)
      // A copy that did not finish never stays half-written. `EEXIST` is the
      // one error that means the name was NOT ours: leave that file alone.
      if (writing && code !== 'EEXIST') await dropPartial(writing)
      if (stopped) {
        cancelled = true
        break
      }
      failedWith(
        s,
        typeof code === 'string'
          ? code
          : String((err as Error | null)?.message ?? err).slice(0, 120)
      )
    }
  }
  if (unsaid >= 0) sayLanded(unsaid)
  endCopies(job)
  await deps.written(destDir, ...(moving ? src : []))
  return {
    pasted,
    failed,
    paths,
    from,
    moved: moving,
    total: src.length,
    ...(failures.length ? { failures } : {}),
    ...(cancelled ? { cancelled } : {})
  }
}
