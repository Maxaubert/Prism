import { createHash } from 'crypto'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { extname, join } from 'path'
import {
  ICON_FILE_TYPES,
  ICON_ID,
  ICON_PX,
  ICON_SOURCE_MAX,
  type IconPick,
  type IconSave
} from '@shared/folderIconFiles'

/**
 * FOLDER ICONS FROM A FILE, MAIN'S HALF (owner, 2026-10-31). Every call here
 * is `fs/promises`: main never waits on the disk (2026-10-12).
 *
 * - The picked file is read (at most 16 MB) and its BYTES go to the page,
 *   never its path: nothing the user picked is ever served.
 * - What comes back must be a PNG of at most 64 x 64; it is kept as
 *   `<folder-icons>/<sha256>.png`, so the same picture is one copy.
 * - The copies are handed to the page as data URLs, all at once.
 * - The folder of the last pick is remembered in `icon-picks.json`; the first
 *   time, or when that folder is gone, the dialog opens on Pictures.
 */

/** Read a picked file for the page: its bytes and type, or why not. */
export async function readIconSource(path: string): Promise<Exclude<IconPick, null>> {
  const type = ICON_FILE_TYPES[extname(path).slice(1).toLowerCase()]
  if (!type) return { refused: 'not-picture' }
  try {
    const s = await stat(path)
    if (!s.isFile()) return { refused: 'unreadable' }
    if (s.size > ICON_SOURCE_MAX) return { refused: 'too-big' }
    const bytes = await readFile(path)
    if (bytes.length > ICON_SOURCE_MAX) return { refused: 'too-big' }
    return { bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length), type }
  } catch {
    return { refused: 'unreadable' }
  }
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** A PNG's width and height from its header (signature, then IHDR first), or
 *  null when it is not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 33) return null
  for (let i = 0; i < SIGNATURE.length; i++) if (bytes[i] !== SIGNATURE[i]) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // Chunk length 13, then "IHDR".
  if (view.getUint32(8) !== 13) return null
  if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== 'IHDR') return null
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  return width && height ? { width, height } : null
}

/** Small enough to be a kept copy: a 64 px PNG is a few KB. */
const SAVE_MAX = 512 * 1024

const dataUrl = (bytes: Uint8Array): string => `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`

/** Keep the page's 64 px PNG by its hash; the same picture twice is one copy. */
export async function saveIconPng(dir: string, bytes: Uint8Array): Promise<IconSave> {
  const size = bytes.length <= SAVE_MAX ? pngSize(bytes) : null
  if (!size || size.width > ICON_PX || size.height > ICON_PX) return { refused: 'not-picture' }
  const id = createHash('sha256').update(bytes).digest('hex')
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${id}.png`)
  // `wx`: an existing copy is the same bytes (it has the same hash).
  await writeFile(file, bytes, { flag: 'wx' }).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== 'EEXIST') throw e
  })
  return { id, url: dataUrl(bytes) }
}

const idOf = (name: string): string | null => {
  const m = /^([0-9a-f]{64})\.png$/.exec(name)
  return m ? m[1] : null
}

/** Every kept copy, as `{ id: dataUrl }`. A missing folder is none. */
export async function listIconFiles(dir: string): Promise<Record<string, string>> {
  const names = await readdir(dir).catch(() => [] as string[])
  const out: Record<string, string> = {}
  await Promise.all(
    names.map(async (name) => {
      const id = idOf(name)
      if (!id) return
      const bytes = await readFile(join(dir, name)).catch(() => null)
      if (bytes) out[id] = dataUrl(bytes)
    })
  )
  return out
}

/** A copy written this recently is kept even when unnamed: another window may
 *  have saved it and not yet stored its choice. */
const FRESH_MS = 60_000

/** Remove the copies no folder uses any more (an icon reset or replaced). */
export async function removeUnusedIcons(dir: string, keep: readonly string[], now = Date.now()): Promise<number> {
  const used = new Set(keep.filter((id) => ICON_ID.test(id)))
  const names = await readdir(dir).catch(() => [] as string[])
  let removed = 0
  await Promise.all(
    names.map(async (name) => {
      const id = idOf(name)
      if (!id || used.has(id)) return
      const file = join(dir, name)
      const s = await stat(file).catch(() => null)
      if (!s || now - s.mtimeMs < FRESH_MS) return
      await rm(file, { force: true }).catch(() => {})
      removed += 1
    })
  )
  return removed
}

const isDir = async (p: string): Promise<boolean> => (await stat(p).catch(() => null))?.isDirectory() ?? false

/** Where the open dialog starts: the last pick's folder while it is there,
 *  else `pictures` (D11). */
export async function readLastIconDir(file: string, pictures: string): Promise<string> {
  try {
    const v = JSON.parse(await readFile(file, 'utf8')) as { lastDir?: unknown }
    if (typeof v.lastDir === 'string' && v.lastDir && (await isDir(v.lastDir))) return v.lastDir
  } catch {
    // None yet, or unreadable: Pictures.
  }
  return pictures
}

/** Remember the folder of a pick. */
export async function writeLastIconDir(file: string, dir: string): Promise<void> {
  await writeFile(file, JSON.stringify({ lastDir: dir }), 'utf8')
}
