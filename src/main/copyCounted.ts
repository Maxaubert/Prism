import { lstat, mkdir, readdir, readlink, rm, stat, symlink, userFs, utimes } from './userFs'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { join } from 'node:path'

/**
 * COPY A FILE OR A WHOLE FOLDER, COUNTED AND STOPPABLE (out of pasteCopy,
 * owner 2026-11-09: the loading bar's Cancel). Streaming so the byte count can
 * tick: fs.cp gives no progress at all, which for a 4GB ISO is minutes of
 * nothing (owner, 2026-09-03). The same copy serves a paste, a move across
 * drives and Duplicate, so all three stop the same way.
 *
 * Cancel aborts the file being written at once, not after it: the caller
 * removes whatever `target` holds with `dropPartial` (its name was free when
 * the copy began, so all of it is this copy's).
 */
export interface CopyOptions {
  /** Abort: the stream stops mid-file and the copy rejects. */
  signal?: AbortSignal
  /** Keep what a move and a Duplicate should keep: file times, and a link as
   *  a link rather than the tree it points into. A paste does neither, as
   *  before (the walk that sizes it counts links as themselves). */
  keep?: boolean
}

/** E2E only: ms per chunk, so a big file is slow enough to be cancelled. */
const slowMs = process.argv.includes('--e2e') ? Number(process.env.PRISM_E2E_SLOW_COPY) || 0 : 0
function slowed(): Transform {
  return new Transform({
    transform(chunk, _encoding, done) {
      setTimeout(() => done(null, chunk), slowMs)
    }
  })
}

export async function copyCounted(
  src: string,
  target: string,
  tick: (bytes: number) => void,
  opts: CopyOptions = {}
): Promise<void> {
  opts.signal?.throwIfAborted()
  if (opts.keep) {
    const link = await lstat(src)
    if (link.isSymbolicLink()) {
      const to = await readlink(src)
      await symlink(to, target, (await stat(src).catch(() => null))?.isDirectory() ? 'junction' : 'file')
      return
    }
  }
  const st = await stat(src)
  if (st.isDirectory()) {
    // Listed BEFORE the new folder is made (2026-10-16): made first, a target
    // inside `src` showed up in its own listing and was copied into itself.
    // `pastesIntoItself` is the real guard; this keeps one level honest even
    // for a caller that forgot it.
    const names = await readdir(src)
    await mkdir(target)
    for (const e of names) {
      await copyCounted(join(src, e), join(target, e), tick, opts)
    }
    return
  }
  const reader = userFs.createReadStream(src)
  reader.on('data', (chunk) => tick(chunk.length))
  const writer = userFs.createWriteStream(target, { flags: 'wx' })
  const signal = opts.signal ? { signal: opts.signal } : {}
  if (slowMs > 0) await pipeline(reader, slowed(), writer, signal)
  else await pipeline(reader, writer, signal)
  if (opts.keep) await utimes(target, st.atime, st.mtime).catch(() => {})
}

/** Remove what a stopped or failed copy left at `target`, retried because a
 *  just-aborted stream can hold its file for a moment (Windows). A target
 *  that existed before the copy never gets here: `wx` and `mkdir` refuse. */
export function dropPartial(target: string): Promise<void> {
  return rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {})
}

/** Was this error the copy being stopped? */
export function isAborted(e: unknown, signal?: AbortSignal): boolean {
  return !!signal?.aborted || (e as { name?: string } | null)?.name === 'AbortError'
}
