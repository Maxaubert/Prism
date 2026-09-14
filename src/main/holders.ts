/**
 * The processes of Prism's own that hold a media file open (2026-09-13, #127).
 *
 * MEASURED: moving the film you are watching failed with "in use by another
 * program" after the player had let go, and the program was Prism - two of
 * its own ffmpeg sidecar decoders, still alive, holding the film with the
 * CRT's share mode, which grants read and write and not delete. Chromium
 * does not cancel a media response the moment its element unmounts, so the
 * decoders lived on past every retry. Letting the element go is not enough:
 * main has to stop what IT started on the file before it renames it.
 *
 * So every ffmpeg main spawns on a media file registers here with the file
 * it reads - the audio sidecar, the waveform's peaks, a conversion - and a
 * move asks `release` for the paths it is about to touch: the matching
 * children are killed and their exit awaited (bounded), because `kill` is
 * TerminateProcess on Windows and returns before the handles are gone. Pure
 * over its inputs: a child is anything with `kill` and a `close` event, so
 * the tests need no ffmpeg.
 */
import { resolve, sep } from 'path'

export interface Held {
  kill(): unknown
  once(event: 'close', fn: () => void): unknown
  /** Already gone: nothing to wait for. */
  exitCode?: number | null
  killed?: boolean
}

const lower = (p: string): string => resolve(p).toLowerCase()

/** Is `file` the path `p` itself or somewhere inside it? */
export function under(file: string, p: string): boolean {
  const f = lower(file)
  const q = lower(p)
  return f === q || f.startsWith(q.endsWith(sep) ? q : q + sep)
}

export class Holders {
  private readonly live = new Map<Held, string>()

  /** A child that reads `file` from now until it closes. */
  add(child: Held, file: string): void {
    this.live.set(child, file)
    child.once('close', () => this.live.delete(child))
  }

  forget(child: Held): void {
    this.live.delete(child)
  }

  /** How many are reading a file under any of `paths`. */
  count(paths: readonly string[]): number {
    let n = 0
    for (const file of this.live.values()) if (paths.some((p) => under(file, p))) n += 1
    return n
  }

  /** Kill every child reading a file under `paths`, and wait for each to
   *  close, up to `timeoutMs` in all. Resolves to how many were killed. */
  async release(paths: readonly string[], timeoutMs = 1500): Promise<number> {
    const victims = [...this.live.entries()].filter(([, file]) => paths.some((p) => under(file, p)))
    if (!victims.length) return 0
    const closed = victims.map(
      ([child]) =>
        new Promise<void>((done) => {
          if (child.exitCode !== undefined && child.exitCode !== null) return done()
          child.once('close', () => done())
          child.kill()
        })
    )
    for (const [child] of victims) this.live.delete(child)
    await Promise.race([Promise.all(closed), new Promise<void>((r) => setTimeout(r, timeoutMs).unref?.())])
    return victims.length
  }
}

/** The one register main uses. */
export const holders = new Holders()
