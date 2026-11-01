import { constants } from 'fs'
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { CopyFormat } from '@shared/imageCopy'
import { encodeImage, type Encoder } from './imageEncode'
import { heicToJpeg, isHeic } from './heicClient'
import { isRaw, rawPreview } from './rawPreview'

/**
 * The real disk and encoder behind Save copies as and the single save's new
 * formats (#474). The steps are `batchCopies.ts` and `saveCopy.ts`.
 *
 * Every picture is made in a folder of the job's own under `%TEMP%`
 * (`prism-copies-*`, gone when the job ends, Cancel included), because the
 * AVIF muxer needs a file it can seek in, and then COPIED into place with
 * "fail if it exists": nothing half-written ever shows in the folder, and
 * nothing is ever written over.
 */

/** A folder for one job's files. */
export const copiesTemp = (): Promise<string> => mkdtemp(join(tmpdir(), 'prism-copies-'))

/** Gone, retried: a just-stopped ffmpeg can hold its file for a moment. */
export const dropTemp = (dir: string): Promise<void> =>
  rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {})

/**
 * Make `src` as `format` at `out`. HEIC and camera RAW are decoded the way
 * the viewer decodes them (the libheif worker; the camera's own full-size
 * preview), and ffmpeg encodes that; everything else ffmpeg reads itself.
 */
export async function convertForCopy(
  tools: Encoder | null,
  src: string,
  out: string,
  format: CopyFormat,
  signal: AbortSignal
): Promise<boolean> {
  if (!tools) return false
  let input = src
  if (isHeic(src) || isRaw(src)) {
    try {
      const { mtimeMs } = await stat(src)
      const jpeg = isHeic(src) ? await heicToJpeg(src, mtimeMs) : await rawPreview(src, mtimeMs)
      input = `${out}.src.jpg`
      await writeFile(input, jpeg)
    } catch {
      return false
    }
  }
  if (signal.aborted) return false
  return encodeImage(tools, input, out, format, signal)
}

/** Put the made file at `target` without ever writing over one there. */
export async function placeCopy(made: string, target: string): Promise<'ok' | 'taken' | 'failed'> {
  try {
    await copyFile(made, target, constants.COPYFILE_EXCL)
  } catch (e) {
    return (e as NodeJS.ErrnoException)?.code === 'EEXIST' ? 'taken' : 'failed'
  }
  await rm(made, { force: true }).catch(() => {})
  return 'ok'
}

/** The single save's WebP, AVIF or JPEG XL, from the PNG the canvas drew. */
export async function transcodePng(tools: Encoder | null, png: Buffer, format: CopyFormat): Promise<Buffer | null> {
  if (!tools) return null
  const dir = await copiesTemp().catch(() => null)
  if (!dir) return null
  try {
    const input = join(dir, 'picture.png')
    const out = join(dir, `copy.${format}`)
    await writeFile(input, png)
    if (!(await encodeImage(tools, input, out, format))) return null
    return await readFile(out)
  } catch {
    return null
  } finally {
    await dropTemp(dir)
  }
}

/** The running jobs, by the chip's job id, for Cancel. */
const running = new Map<string, AbortController>()

export function startCopies(job: string): AbortController {
  const stop = new AbortController()
  if (job) running.set(job, stop)
  return stop
}

export function endCopies(job: string): void {
  running.delete(job)
}

/** Cancel: true when there was such a job to stop. */
export function cancelCopies(job: string): boolean {
  const stop = running.get(job)
  stop?.abort()
  return !!stop
}
