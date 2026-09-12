/**
 * The phone's diagnostics log (2026-09-12): `userData/phone/phone.log`.
 *
 * An iPad has no Web Inspector without a Mac beside it, and a stream that
 * hitches twenty times in a film leaves nothing behind on the PC that says
 * why. So both halves write ONE timeline here: the server logs every
 * segment ask with how long it waited and every restart, kill and reap of
 * a job, and the phone page posts what its player saw (`/api/diag`: hls.js
 * error events, stalls, seeks, a buffer sample every ten seconds). Reading
 * the two side by side is what tells a network stall from a decoder one.
 *
 * Always on and cheap: a line is a few dozen bytes appended by one
 * serialised `fs/promises` write, fifteen or so a minute while a film
 * plays. Rotated at 2MB into one `.1` file, so it never grows past that.
 */
import { promises as fsp } from 'fs'
import { dirname } from 'path'

const ROTATE_AT = 2 * 1024 * 1024

export class PhoneLog {
  private queue: Promise<void> = Promise.resolve()
  private size: number | null = null

  constructor(private readonly file: string) {}

  /** Append one line, stamped. Never throws and never blocks the caller:
   *  a log that cannot be written is a log, not a broken stream. */
  line(text: string): void {
    const stamp = new Date().toISOString()
    const out = `${stamp} ${text.replace(/[\r\n]+/g, ' ')}\n`
    this.queue = this.queue
      .then(async () => {
        if (this.size === null) {
          // The folder is made here rather than assumed: `userData/phone`
          // does not exist until the first job runs, and the first lines
          // of a session (the play answer that opened it) were lost to
          // ENOENT before the jobs had made it.
          await fsp.mkdir(dirname(this.file), { recursive: true }).catch(() => undefined)
          this.size = await fsp
            .stat(this.file)
            .then((s) => s.size)
            .catch(() => 0)
        }
        if (this.size > ROTATE_AT) {
          await fsp.rename(this.file, `${this.file}.1`).catch(() => undefined)
          this.size = 0
        }
        await fsp.appendFile(this.file, out)
        this.size += Buffer.byteLength(out)
      })
      .catch(() => undefined)
  }

  /** Every write so far has landed (tests, and shutdown). */
  flush(): Promise<void> {
    return this.queue
  }
}

/** The shape `/api/diag` accepts from a phone: a handful of short lines.
 *  Pure, so the cap is tested: a page cannot fill the disk with one post,
 *  and a line cannot smuggle a newline into another record. */
export const DIAG_MAX_LINES = 60
export const DIAG_MAX_CHARS = 400

export function diagLines(body: unknown): string[] {
  const raw = (body as { lines?: unknown })?.lines
  if (!Array.isArray(raw)) return []
  return raw
    .filter((l): l is string => typeof l === 'string' && l.trim() !== '')
    .slice(0, DIAG_MAX_LINES)
    .map((l) => l.replace(/[\r\n]+/g, ' ').slice(0, DIAG_MAX_CHARS))
}
