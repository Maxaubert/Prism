import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { realpath, rename, rm, writeFile } from 'node:fs/promises'

/** Refusals that mean "not this way", not "the disk is broken": a folder the
 *  user may not create files in, or a file another program holds open without
 *  delete sharing. An in-place write still works for those. */
const IN_PLACE_OK = new Set(['EPERM', 'EACCES', 'EBUSY'])

const code = (e: unknown): string => String((e as NodeJS.ErrnoException)?.code ?? '')

/**
 * The editor's save, whole or not at all (2026-10-16).
 *
 * It was `writeFile(p, ...)`, which truncates first: on a full disk or a
 * pulled USB stick the document was left empty or half written and all the
 * user saw was "Couldn't save". The bytes now go to a hidden tmp file beside
 * the file (dot-named, so the watchers ignore it) and a rename swaps them in,
 * so a failed write leaves the original exactly as it was.
 *
 * A link is followed first: renaming over the link would replace the link
 * with a plain file. Where the swap is refused rather than failed (a folder
 * that allows writing the file but not creating one beside it, a file another
 * program holds open without delete sharing), it writes in place, as it
 * always did. Everything else throws, for the caller to name.
 */
export async function replaceFile(target: string, bytes: Uint8Array): Promise<void> {
  const real = await realpath(target).catch(() => target)
  const tmp = join(dirname(real), `.${basename(real)}.${randomUUID()}.tmp`)
  try {
    try {
      await writeFile(tmp, bytes)
    } catch (e) {
      if (!IN_PLACE_OK.has(code(e))) throw e
      await writeFile(real, bytes)
      return
    }
    try {
      await rename(tmp, real)
    } catch (e) {
      if (!IN_PLACE_OK.has(code(e))) throw e
      await writeFile(real, bytes)
    }
  } finally {
    await rm(tmp, { force: true }).catch(() => {})
  }
}
