import { appendFileSync, renameSync, statSync } from 'fs'

/**
 * A few lines about every time the window's page died, hung or was not shown
 * (#265). The case that started this left NOTHING behind: no dump, nothing in
 * the event log, a process alive with no window. This is what the next one
 * leaves, in userData, on this machine only.
 *
 * Capped: past `cap` bytes the file becomes `<file>.old` (replacing the one
 * before) and a new one starts, so a crash loop cannot fill a disk. Never
 * throws: a log that cannot be written must not stop the recovery it records.
 */
export const CRASH_LOG_CAP = 64 * 1024

export function appendCrashLog(file: string, line: string, cap = CRASH_LOG_CAP): void {
  const text = line.replace(/[\r\n]+/g, ' ') + '\n'
  try {
    let size = 0
    try {
      size = statSync(file).size
    } catch {
      /* no file yet */
    }
    if (size > 0 && size + Buffer.byteLength(text) > cap) renameSync(file, `${file}.old`)
    appendFileSync(file, text)
  } catch {
    /* a log that cannot be written is not a reason to stay broken */
  }
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
