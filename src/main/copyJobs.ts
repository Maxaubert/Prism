import { constants } from 'fs'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { CopyFormat } from '@shared/imageCopy'
import { encodeImage, type Encoder } from './imageEncode'
import { heicToJpegForCopy, isHeic } from './heicClient'
import { isRaw, readRawPreview } from './rawPreview'

/**
 * The real disk and encoder behind Save copies as and the single save's new
 * formats (#474). The steps are `batchCopies.ts` and `saveCopy.ts`.
 *
 * Every picture is made in a folder of the job's own under `%TEMP%`
 * (`prism-copies-*`, gone when the job ends, Cancel included), because the
 * AVIF muxer needs a file it can seek in, and then COPIED into place with
 * "fail if it exists": nothing is ever written over, and a copy that fails
 * to encode never reaches the folder. The copy itself writes straight to the
 * final name, so a big one is in the folder, growing, while it is copied
 * (review, 2026-11-01: this said "nothing half-written ever shows", which a
 * plain copy cannot promise; a rename into place could not refuse a taken
 * name the same way).
 *
 * A HEIC or RAW is decoded to a JPEG beside its copy, and that JPEG goes as
 * soon as the copy is made: 400 HEICs kept 1-2 GB of them in temp until the
 * job ended (review, 2026-11-01). The decoders are the batch's own, never the
 * viewer's: no cache, and no queue the viewer waits in.
 */

/** A folder for one job's files. */
export const copiesTemp = (): Promise<string> => mkdtemp(join(tmpdir(), 'prism-copies-'))

/** Gone, retried: a just-stopped ffmpeg can hold its file for a moment. */
export const dropTemp = (dir: string): Promise<void> =>
  rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {})

/**
 * Make `src` as `format` at `out`. HEIC and camera RAW are decoded the way
 * the viewer decodes them (libheif in a worker, the batch's own; the
 * camera's own full-size preview), and ffmpeg encodes that; everything else
 * ffmpeg reads itself.
 */
export async function convertForCopy(
  tools: Encoder | null,
  src: string,
  out: string,
  format: CopyFormat,
  signal: AbortSignal
): Promise<boolean> {
  if (!tools) return false
  if (!isHeic(src) && !isRaw(src)) return encodeImage(tools, src, out, format, signal)
  const input = `${out}.src.jpg`
  try {
    const jpeg = isHeic(src) ? await heicToJpegForCopy(src) : await readRawPreview(src)
    if (signal.aborted) return false
    await writeFile(input, jpeg)
    return await encodeImage(tools, input, out, format, signal)
  } catch {
    return false
  } finally {
    await rm(input, { force: true }).catch(() => {})
  }
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
