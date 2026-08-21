import { existsSync, readFileSync, statSync, writeFileSync } from 'fs'

/**
 * The tab strip, across restarts.
 *
 * Modelled on window-state.json and for the same reasons: a small file in
 * userData, written on a debounce, and treated as a suggestion rather than as
 * truth. A root you deleted last week is dropped without a word - a viewer that
 * opens with an error dialog about a folder that is gone is worse than one that
 * quietly opens with one tab fewer.
 *
 * Roots are absolute paths on one machine. Nothing here is portable and nothing
 * here is precious: losing the file costs you the strip, not any work.
 */

export interface SavedTab {
  root: string
  /** The file that tab was showing. Absent if it was showing none. */
  file?: string
  /** The terminal was showing, in this view. The shell itself dies with the
   *  app; this remembers only that the tab should come back AS a terminal. */
  term?: 'full' | 'split'
  /** The shell hosted a CLAUDE session when the strip was saved: restore may
   *  resume it (`claude --continue` rebuilds the conversation per folder). */
  agent?: boolean
}

export interface SavedTabs {
  tabs: SavedTab[]
  /** Index into `tabs` of the one that was in front. */
  active: number
}

const NONE: SavedTabs = { tabs: [], active: 0 }

const isFolder = (p: string): boolean => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/**
 * Read a saved strip out of JSON, keeping only what still exists.
 *
 * Pure and separate from the file system read so it can be tested: everything
 * interesting here is the filtering, not the reading. A root that is gone (or
 * has become a file) takes its tab with it, and the active index follows the
 * tab it named rather than staying on a number that now means someone else.
 */
export function parseTabs(raw: string): SavedTabs {
  let doc: unknown
  try {
    doc = JSON.parse(raw)
  } catch {
    return NONE
  }
  if (!doc || typeof doc !== 'object') return NONE
  const list = (doc as { tabs?: unknown }).tabs
  if (!Array.isArray(list)) return NONE

  const wasActive = (doc as { active?: unknown }).active
  const activeRoot =
    typeof wasActive === 'number' && list[wasActive] && typeof list[wasActive] === 'object'
      ? (list[wasActive] as { root?: unknown }).root
      : undefined

  const tabs: SavedTab[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const { root, file, term, agent } = entry as { root?: unknown; file?: unknown; term?: unknown; agent?: unknown }
    if (typeof root !== 'string' || !isFolder(root)) continue
    const tab: SavedTab = typeof file === 'string' && existsSync(file) ? { root, file } : { root }
    if (term === 'full' || term === 'split') {
      tab.term = term
      if (agent === true) tab.agent = true // only meaningful with a terminal
    }
    tabs.push(tab)
  }
  // Follow the tab that was in front, not the index it happened to sit at.
  const active = tabs.findIndex((t) => t.root === activeRoot)
  return { tabs, active: active >= 0 ? active : 0 }
}

export function readTabs(path: string): SavedTabs {
  try {
    return parseTabs(readFileSync(path, 'utf8'))
  } catch {
    return NONE // no file yet, or one we cannot read
  }
}

export function writeTabs(path: string, state: SavedTabs): void {
  try {
    writeFileSync(path, JSON.stringify(state))
  } catch {
    /* a viewer that cannot write its tab strip is still a viewer */
  }
}
