import { parse } from 'path'
import type { BrowseDriveUsage } from '@shared/browse'
import type { BinDriveUsage, BinUsage } from '@shared/ipcTypes'
import type { BinRead } from './binList'

/**
 * WHAT EMPTY RECYCLE BIN WOULD FREE (#503; owner, 2026-11-10: "show how much
 * space I will get back"). The bin's rows already carry the `$I` sizes (the
 * list reads them), so this only adds them up by the drive each bin folder
 * is on, then asks each such drive for its own size and free space the way
 * This PC does (`driveUsage`: statfs, never a shell, a drive that does not
 * answer in time simply has no sizes). A drive with nothing in its bin is
 * left out, so the question draws one bar per drive that frees something.
 * Nothing here is given a path by the renderer: the folders are `binDirs()`.
 */
export async function binUsage(
  dirs: readonly string[],
  read: (dirs: readonly string[]) => Promise<Pick<BinRead, 'rows'>>,
  spaceOf: (roots: string[]) => Promise<BrowseDriveUsage[]>
): Promise<BinUsage> {
  const { rows } = await read(dirs)
  const by = new Map<string, { items: number; bytes: number }>()
  for (const r of rows) {
    const root = `${parse(r.dir).root.slice(0, 1).toUpperCase()}:\\`
    const sum = by.get(root) ?? { items: 0, bytes: 0 }
    sum.items += 1
    sum.bytes += r.size
    by.set(root, sum)
  }
  if (!by.size) return { items: 0, bytes: 0, drives: [] }
  const roots = [...by.keys()].sort()
  const space = await spaceOf(roots).catch((): BrowseDriveUsage[] => [])
  const drives: BinDriveUsage[] = roots.map((path) => {
    const s = space.find((d) => d.path.toUpperCase() === path)
    const sum = by.get(path)!
    return {
      path,
      items: sum.items,
      bytes: sum.bytes,
      ...(s?.total !== undefined && s.free !== undefined ? { total: s.total, free: s.free } : {})
    }
  })
  return {
    items: drives.reduce((n, d) => n + d.items, 0),
    bytes: drives.reduce((n, d) => n + d.bytes, 0),
    drives
  }
}
