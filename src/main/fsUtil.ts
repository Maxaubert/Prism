import { access } from 'fs/promises'

/**
 * The small fs answers main asks everywhere, in one place (structure cleanup,
 * 2026-10-12). Atomic writes live beside `latestWriter` in `latestWrite.ts`.
 */

/** `existsSync`'s answer without holding main on the disk (owner, 2026-10-12,
 *  the 3.9 s tabs.json freeze: main never waits on the disk while the user
 *  works). Anything that cannot be reached is absent, as `existsSync` said. */
export const exists = (p: string): Promise<boolean> =>
  access(p).then(
    () => true,
    () => false
  )

/** Wait `ms` without holding anything. */
export const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/** Windows' "another process has this open" (MEASURED 2026-09-13: EBUSY
 *  from a Node read stream on the file, and from ffmpeg reading it). */
export const isBusyError = (e: unknown): boolean => {
  const code = (e as NodeJS.ErrnoException)?.code
  return code === 'EBUSY' || code === 'EPERM'
}
