import { appendFile, rename, stat } from 'fs/promises'

/**
 * A few lines about every time the window's page died, hung or was not shown
 * (#265). The case that started this left NOTHING behind: no dump, nothing in
 * the event log, a process alive with no window. This is what the next one
 * leaves, in userData, on this machine only.
 *
 * Capped: past `cap` bytes the file becomes `<file>.old` (replacing the one
 * before) and a new one starts, so a crash loop cannot fill a disk. Never
 * throws or rejects: a log that cannot be written must not stop the recovery it
 * records.
 *
 * Written off the main thread (owner, 2026-10-12, the 3.9 s tabs.json freeze:
 * main never waits on the disk), one write at a time per file so lines keep
 * their order and the size check sees the line before it. The promise settles
 * once THIS line is down; `crashLogSettled` waits for every line asked for.
 */
export const CRASH_LOG_CAP = 64 * 1024

const queues = new Map<string, Promise<void>>()

async function writeLine(file: string, text: string, cap: number): Promise<void> {
  try {
    let size = 0
    try {
      size = (await stat(file)).size
    } catch {
      /* no file yet */
    }
    if (size > 0 && size + Buffer.byteLength(text) > cap) await rename(file, `${file}.old`)
    await appendFile(file, text)
  } catch {
    /* a log that cannot be written is not a reason to stay broken */
  }
}

export function appendCrashLog(file: string, line: string, cap = CRASH_LOG_CAP): Promise<void> {
  const text = line.replace(/[\r\n]+/g, ' ') + '\n'
  const next = (queues.get(file) ?? Promise.resolve()).then(() => writeLine(file, text, cap))
  queues.set(file, next)
  void next.then(() => {
    if (queues.get(file) === next) queues.delete(file)
  })
  return next
}

/** Every line asked for so far is on disk (or has failed quietly): what a
 *  quit right after a crash line awaits, so the line is not lost. */
export function crashLogSettled(): Promise<void> {
  return Promise.all([...queues.values()]).then(() => undefined)
}

/** One line: the time, what happened, then `key=value` pairs in the order given. */
export function crashLine(
  at: Date,
  event: string,
  fields: Record<string, string | number | boolean | undefined>
): string {
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${String(v)}`)
  return [at.toISOString(), event, ...parts].join(' ')
}
