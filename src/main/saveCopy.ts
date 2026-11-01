import { dirname, isAbsolute, join, relative, resolve } from 'path'
import { samePath } from '@shared/path'
import type { SaveCopyResult } from '@shared/ipcTypes'

/**
 * SAVE A COPY, THE STEPS (#78; owner, 2026-11-01, the image pack spec
 * "approved as recommended"). The IPC handler in `ipc/files.ts` hands these
 * the real dialog and the real write; `saveCopy.test.ts` hands fakes.
 *
 * - The dialog opens IN THE PHOTO'S OWN FOLDER with its name filled in
 *   ("IMG_0412.jpg"), not wherever the last save went.
 * - The answer says which of three things happened, so the note can: the
 *   name that was saved, a cancel (which says nothing), or a failure (a
 *   read-only folder, a full disk) which used to say nothing either.
 * - It converts, it never edits: a target that IS the photo being viewed is
 *   refused, and the original is never touched.
 * - NOT in a temp copy's folder (review, 2026-11-01): a member of a zip
 *   browsed as a folder (#300) is shown from its unpacked copy under
 *   `%TEMP%\prism-members`, removed at quit (`memberTemp.ts`), and a copy
 *   saved beside it was lost. Any of Prism's own temp folders
 *   (`%TEMP%\prism-*`: members, extracted archive files) opens the dialog
 *   with the name alone, where Windows last saved, as before #78.
 */

export interface SaveCopyRequest {
  bytes: ArrayBuffer
  /** The picture's name, whose extension is replaced. */
  suggested: string
  format: 'png' | 'jpeg'
  /** The photo on disk, when it is a file: where the dialog opens. */
  source?: string
}

export interface SaveCopyDeps {
  ask: (opts: { defaultPath: string; filters: { name: string; extensions: string[] }[] }) => Promise<{
    canceled: boolean
    filePath?: string
  }>
  write: (path: string, bytes: Buffer) => Promise<void>
  written: (path: string) => Promise<void>
  /** The system temp folder (`os.tmpdir()`), where Prism's copies live. */
  temp: string
}

/** Is `p` inside one of Prism's own temp folders (`<temp>\prism-*\...`),
 *  which Prism removes, so nothing should be saved beside it. */
export function isPrismTempCopy(p: string, temp: string): boolean {
  if (!isAbsolute(p) || !temp) return false
  const rel = relative(resolve(temp).toLowerCase(), resolve(p).toLowerCase())
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return false
  const parts = rel.split(/[\\/]/)
  return parts.length > 1 && parts[0].startsWith('prism-')
}

const extOf = (format: 'png' | 'jpeg'): string => (format === 'png' ? 'png' : 'jpg')

/** "C:\pics\IMG_0412.jpg" for IMG_0412.HEIC saved as JPEG. */
export function copyDefaultPath(suggested: string, format: 'png' | 'jpeg', source?: string): string {
  const base = suggested.replace(/\.[^.]*$/, '')
  const name = base + '.' + extOf(format)
  if (!source) return name
  const at = join(dirname(source), name)
  // A PNG saved as PNG would be offered its own name, which is refused.
  return samePath(at, source) ? join(dirname(source), `${base} copy.${extOf(format)}`) : at
}

export async function saveImageCopy(req: SaveCopyRequest, deps: SaveCopyDeps): Promise<SaveCopyResult> {
  if (!(req.bytes instanceof ArrayBuffer) || !req.bytes.byteLength) return { failed: true }
  const ext = extOf(req.format)
  const source = typeof req.source === 'string' && req.source ? req.source : undefined
  const r = await deps.ask({
    // A temp copy still guards the target below; it only stops saying where to open.
    defaultPath: copyDefaultPath(
      String(req.suggested ?? ''),
      req.format,
      source && !isPrismTempCopy(source, deps.temp) ? source : undefined
    ),
    filters: [{ name: req.format === 'png' ? 'PNG image' : 'JPEG image', extensions: [ext] }]
  })
  if (r.canceled || !r.filePath) return { canceled: true }
  if (source && samePath(r.filePath, source)) return { failed: true, reason: 'source' }
  try {
    await deps.write(r.filePath, Buffer.from(req.bytes))
  } catch {
    return { failed: true }
  }
  await deps.written(r.filePath).catch(() => {})
  return { saved: r.filePath }
}
