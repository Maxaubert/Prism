import { watch, type FSWatcher } from 'fs'
import { access } from 'fs/promises'
import { BIN_PLACE } from '@shared/binPlace'
import type { DirChange } from '@shared/types'

/**
 * THE BIN, WATCHED (Recycle Bin feature, D9). One non-recursive `fs.watch` on
 * each existing bin folder (one per drive), a 250 ms debounce, one set per tab
 * like `browseWatch`. It reports the existing `DirChange` shape for the bin
 * place, so the page's re-read flow (`dir-changed`, the loading-bar hold) runs
 * unchanged. A bin folder that does not exist yet (a drive never binned to) is
 * not watched; the next focus read finds it. Binning from Prism, from File
 * Explorer or from another program all show up while the bin is open.
 */
const DEBOUNCE_MS = 250

interface BinWatch {
  watchers: FSWatcher[]
  timer: ReturnType<typeof setTimeout> | null
}

const watches = new Map<string, BinWatch>()
/** Each tab's newest ask: one still probing its folders must not land over a newer ask or a close. */
const turns = new Map<string, number>()
let turnSeq = 0

export function closeBinWatch(tabId: string): void {
  turns.delete(tabId)
  const current = watches.get(tabId)
  if (!current) return
  watches.delete(tabId)
  if (current.timer) clearTimeout(current.timer)
  for (const w of current.watchers) w.close()
}

export function closeAllBinWatches(): void {
  turns.clear()
  for (const id of [...watches.keys()]) closeBinWatch(id)
}

export async function setBinWatch(
  tabId: string,
  dirs: readonly string[],
  emit: (change: DirChange) => void
): Promise<boolean> {
  closeBinWatch(tabId)
  const turn = ++turnSeq
  turns.set(tabId, turn)
  // Awaited probes (main never waits on the disk), not an existsSync.
  const there = await Promise.all(dirs.map((d) => access(d).then(() => true, () => false)))
  if (turns.get(tabId) !== turn) return true // a newer ask or a close decides
  const current: BinWatch = { watchers: [], timer: null }
  const changed = (): void => {
    if (current.timer) clearTimeout(current.timer)
    current.timer = setTimeout(() => {
      current.timer = null
      if (watches.get(tabId) === current) emit({ root: BIN_PLACE, dirs: [BIN_PLACE] })
    }, DEBOUNCE_MS)
  }
  for (const [i, dir] of dirs.entries()) {
    if (!there[i]) continue
    try {
      const w = watch(dir, { recursive: false, persistent: false }, changed)
      w.on('error', () => {})
      current.watchers.push(w)
    } catch {
      /* a drive that went away between the probe and the watch: simply not watched */
    }
  }
  watches.set(tabId, current)
  return true
}
