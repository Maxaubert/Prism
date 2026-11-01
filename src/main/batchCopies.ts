import { basename, dirname, join } from 'path'
import { fileKind } from '@shared/fileKind'
import { canCopyImage, copyExt, type CopyFormat } from '@shared/imageCopy'
import { extOf } from '@shared/path'
import type { SaveCopiesResult } from '@shared/ipcTypes'

/**
 * SAVE COPIES AS, MANY PICTURES IN ONE JOB (#474; owner, 2026-11-01: "the
 * real fix for 400 iPhone HEICs and this site will not take them"). Select
 * pictures in the Explorer, right-click, Save copies as, a format:
 *
 * - Each copy goes NEXT TO ITS ORIGINAL. A taken name becomes "name (2).ext",
 *   the original's own name included (a PNG saved as PNG), and nothing is
 *   ever written over: the copy is placed with "fail if it exists", and a name
 *   taken between the pick and the write moves on to the next.
 * - One job: the chip's progress and Cancel. Cancel stops what is running and
 *   starts nothing more; the copies already made stay, and are marked.
 * - Rows that are not pictures (a folder, a text file) are skipped and
 *   counted. A picture no copy can be made of is counted as failed ("could
 *   not be read"): one that cannot be read, decoded or written, an SVG (a
 *   drawing the bundled ffmpeg cannot read), one outside the wall, one the
 *   disk will not stat (review, 2026-11-01: those were "not pictures").
 *   The done note says both.
 * - A made file that does not land is thrown away at once (`discard`), so a
 *   long job does not pile its failures up in temp.
 * - Two at a time: each encoder already uses several cores, and the PC this
 *   is built on is short of memory.
 *
 * The steps only; `ipc/files.ts` hands the real encoder and disk, and
 * `batchCopies.test.ts` hands fakes.
 */

export interface CopiesRequest {
  paths: string[]
  format: CopyFormat
}

export interface CopiesDeps {
  /** May this file be read and a copy written beside it (the wall). */
  allowed: (p: string) => boolean
  /** A file, something else (a folder), or null when it cannot be stat'ed. */
  entry: (p: string) => Promise<'file' | 'other' | null>
  /** Make `src` as `format` at `out` (decoding HEIC and RAW first). */
  convert: (src: string, out: string, format: CopyFormat, signal: AbortSignal) => Promise<boolean>
  exists: (p: string) => Promise<boolean>
  /** Put the made file at `target`, never over anything. */
  place: (made: string, target: string) => Promise<'ok' | 'taken' | 'failed'>
  written: (p: string) => Promise<void>
  /** Throw away a made file that did not land (it may not exist). */
  discard: (p: string) => Promise<void>
  /** `done` of `total` pictures are through (saved or failed). */
  progress: (done: number, total: number) => void
  /** A folder of this job's own, for the files being made. */
  tmp: string
  signal: AbortSignal
  atOnce?: number
}

const AT_ONCE = 2

/** Where the copy of `src` goes: beside it, the format's extension, and the
 *  first free "name (n).ext" when that is taken on disk or by this job. */
export async function copyTarget(
  src: string,
  format: CopyFormat,
  given: ReadonlySet<string>,
  exists: (p: string) => Promise<boolean>
): Promise<string> {
  const dir = dirname(src)
  const stem = basename(src).replace(/\.[^.]*$/, '')
  const ext = copyExt(format)
  const free = async (p: string): Promise<boolean> => !given.has(p.toLowerCase()) && !(await exists(p))
  const first = join(dir, `${stem}.${ext}`)
  if (await free(first)) return first
  for (let i = 2; i < 10000; i += 1) {
    const p = join(dir, `${stem} (${i}).${ext}`)
    if (await free(p)) return p
  }
  return join(dir, `${stem} (${Date.now()}).${ext}`)
}

export async function saveCopies(req: CopiesRequest, deps: CopiesDeps): Promise<SaveCopiesResult> {
  const { format } = req
  const { signal } = deps
  let skipped = 0
  let failed = 0
  const work: string[] = []
  for (const p of req.paths) {
    if (typeof p !== 'string' || !p || fileKind(extOf(p)) !== 'image') {
      skipped += 1
      continue
    }
    const kind = canCopyImage(p) && deps.allowed(p) ? await deps.entry(p).catch(() => null) : null
    if (kind === 'file') work.push(p)
    else if (kind === 'other') skipped += 1
    else failed += 1
  }
  const saved: Array<{ i: number; path: string }> = []
  let done = 0
  // Names are picked one at a time, so two pictures that would make the same
  // name (x.png and x.gif as JPEG) never both pick it.
  const given = new Set<string>()
  let naming: Promise<unknown> = Promise.resolve()
  const pick = (src: string): Promise<string> => {
    const next = naming.then(async () => {
      const at = await copyTarget(src, format, given, deps.exists)
      given.add(at.toLowerCase())
      return at
    })
    naming = next.catch(() => {})
    return next
  }

  const one = async (i: number): Promise<void> => {
    const src = work[i]
    const made = join(deps.tmp, `${i}.${copyExt(format)}`)
    const ok = await deps.convert(src, made, format, signal).catch(() => false)
    if (signal.aborted) return // stopped, not failed (the job's temp folder goes)
    let landed: string | null = null
    if (ok) {
      for (let tries = 0; tries < 5 && !landed; tries += 1) {
        const target = await pick(src)
        const r = await deps.place(made, target).catch(() => 'failed' as const)
        if (r === 'ok') landed = target
        else if (r === 'failed') break
      }
    }
    if (landed) {
      saved.push({ i, path: landed })
      await deps.written(landed).catch(() => {})
    } else {
      failed += 1
      await deps.discard(made).catch(() => {})
    }
    done += 1
    deps.progress(done, work.length)
  }

  let next = 0
  const lane = async (): Promise<void> => {
    while (next < work.length && !signal.aborted) await one(next++)
  }
  await Promise.all(Array.from({ length: Math.min(deps.atOnce ?? AT_ONCE, work.length) }, lane))
  return {
    saved: saved.sort((a, b) => a.i - b.i).map((s) => s.path),
    failed,
    skipped,
    canceled: signal.aborted
  }
}
