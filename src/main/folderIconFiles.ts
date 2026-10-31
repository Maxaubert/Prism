import { createHash, randomBytes } from 'crypto'
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'fs/promises'
import { extname, join } from 'path'
import {
  ICON_ID,
  ICON_PX,
  ICON_SIDE_MAX,
  ICON_SOURCE_MAX,
  iconFileType,
  type IconList,
  type IconPick,
  type IconSave
} from '@shared/folderIconFiles'
import { pictureSize, pngSize } from '@shared/pictureSize'

export { pngSize }

/**
 * FOLDER ICONS FROM A FILE, MAIN'S HALF (owner, 2026-10-31). Every call here
 * is `fs/promises`: main never waits on the disk (2026-10-12).
 *
 * - The picked file is read (at most 16 MB) and its BYTES go to the page,
 *   never its path: nothing the user picked is ever served. Its size is read
 *   from its header first, and a picture over 8,192 px a side is refused
 *   before the page decodes it (review M2).
 * - What comes back must be a PNG of at most 64 x 64; it is kept as
 *   `<folder-icons>/<sha256>.png`, so the same picture is one copy.
 * - The copies are handed to the page as data URLs, all at once.
 * - The folder of the last pick is remembered in `icon-picks.json`; the first
 *   time, or when that folder is gone, the dialog opens on Pictures.
 */

/** Read a picked file for the page: its bytes and type, or why not. */
export async function readIconSource(path: string): Promise<Exclude<IconPick, null>> {
  const type = iconFileType(extname(path).slice(1))
  if (!type) return { refused: 'not-picture' }
  let bytes: Uint8Array
  try {
    const s = await stat(path)
    if (!s.isFile()) return { refused: 'unreadable' }
    if (s.size > ICON_SOURCE_MAX) return { refused: 'too-big' }
    const read = await readFile(path)
    if (read.length > ICON_SOURCE_MAX) return { refused: 'too-big' }
    bytes = new Uint8Array(read.buffer, read.byteOffset, read.length)
  } catch {
    return { refused: 'unreadable' }
  }
  if (type !== 'image/svg+xml') {
    const size = pictureSize(bytes)
    if (!size) return { refused: 'not-picture' }
    if (size.width > ICON_SIDE_MAX || size.height > ICON_SIDE_MAX) return { refused: 'too-large' }
  }
  return { bytes, type }
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
  // An existing copy is the same bytes (it has the same hash). Its time is
  // made NOW (review M3): a copy that was old and unused, picked again here,
  // is then inside the grace period of another window's prune, whose `keep`
  // cannot name it yet.
  const touch = (): Promise<boolean> => {
    const now = new Date()
    return utimes(file, now, now).then(
      () => true,
      () => false
    )
  }
  if (await touch()) return { id, url: dataUrl(bytes) }
  // Written beside it and renamed into place (review L5): another window's
  // listing never reads half a copy, and the temporary name is no copy's.
  const temp = join(dir, `${id}.${randomBytes(6).toString('hex')}.tmp`)
  await writeFile(temp, bytes)
  try {
    await rename(temp, file)
  } catch (e) {
    await rm(temp, { force: true }).catch(() => {})
    // Another window put the same copy there first (and may hold it open).
    const there = (await touch()) || (await stat(file).then(
      () => true,
      () => false
    ))
    if (!there) throw e
  }
  return { id, url: dataUrl(bytes) }
}

const idOf = (name: string): string | null => {
  const m = /^([0-9a-f]{64})\.png$/.exec(name)
  return m ? m[1] : null
}

const gone = (e: unknown): boolean => (e as NodeJS.ErrnoException | null)?.code === 'ENOENT'

/**
 * Every kept copy, as `{ id: dataUrl }`. A missing folder is none, and a copy
 * removed between the listing and its read is simply not there. ANY OTHER
 * read error (a copy an antivirus holds, EBUSY or EPERM) makes the list
 * incomplete (review M1): the page then drops no entry, where it would
 * otherwise lose a choice whose picture is fine.
 */
export async function listIconFiles(dir: string): Promise<IconList> {
  let complete = true
  const names = await readdir(dir).catch((e: unknown) => {
    if (!gone(e)) complete = false
    return [] as string[]
  })
  const files: Record<string, string> = {}
  await Promise.all(
    names.map(async (name) => {
      const id = idOf(name)
      if (!id) return
      const bytes = await readFile(join(dir, name)).catch((e: unknown) => {
        if (!gone(e)) complete = false
        return null
      })
      if (bytes) files[id] = dataUrl(bytes)
    })
  )
  return { files, complete }
}

/** A copy written this recently is kept even when unnamed: another window may
 *  have saved it and not yet stored its choice. */
export const FRESH_MS = 60_000

/** A half-written copy a crash left behind (`<id>.<random>.tmp`). */
const TEMP = /^[0-9a-f]{64}\.[0-9a-f]{12}\.tmp$/

/** Remove the copies no folder uses any more (an icon reset or replaced), and
 *  any stale half-written one. `fresh` is the grace period (the e2e shortens
 *  it). */
export async function removeUnusedIcons(
  dir: string,
  keep: readonly string[],
  now = Date.now(),
  fresh = FRESH_MS
): Promise<number> {
  const used = new Set(keep.filter((id) => ICON_ID.test(id)))
  const names = await readdir(dir).catch(() => [] as string[])
  let removed = 0
  await Promise.all(
    names.map(async (name) => {
      const id = idOf(name)
      const unused = id ? !used.has(id) : TEMP.test(name)
      if (!unused) return
      const file = join(dir, name)
      const s = await stat(file).catch(() => null)
      if (!s || now - s.mtimeMs < fresh) return
      await rm(file, { force: true }).catch(() => {})
      removed += 1
    })
  )
  return removed
}

/** How long the dialog waits to learn whether the last folder is there
 *  (review L4): an offline share would otherwise hold From a file... for the
 *  whole SMB timeout. Past this, it opens on Pictures. */
const DIR_WAIT_MS = 1500

async function isDir(p: string, wait: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<false>((done) => {
    timer = setTimeout(() => done(false), wait)
  })
  const there = stat(p).then(
    (s) => s.isDirectory(),
    () => false
  )
  try {
    return await Promise.race([there, late])
  } finally {
    clearTimeout(timer)
  }
}

/** Where the open dialog starts: the last pick's folder while it is there
 *  (and answers within `wait`), else `pictures` (D11). */
export async function readLastIconDir(file: string, pictures: string, wait = DIR_WAIT_MS): Promise<string> {
  try {
    const v = JSON.parse(await readFile(file, 'utf8')) as { lastDir?: unknown }
    if (typeof v.lastDir === 'string' && v.lastDir && (await isDir(v.lastDir, wait))) return v.lastDir
  } catch {
    // None yet, or unreadable: Pictures.
  }
  return pictures
}

/** Remember the folder of a pick. */
export async function writeLastIconDir(file: string, dir: string): Promise<void> {
  await writeFile(file, JSON.stringify({ lastDir: dir }), 'utf8')
}
