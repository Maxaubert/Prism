import { existsSync, readFileSync, statSync, writeFileSync } from 'fs'
import { isAbsolute, relative, resolve } from 'path'

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
  /** How many shells the tab held (2026-09-03): a tab with three comes back
   *  with three slots, the current one spawned and the rest spawned when
   *  picked. Absent or 1 means the one `term` describes. */
  terms?: number
  /**
   * WHERE that shell was standing (2026-09-09).
   *
   * A tab is a root and a current file, and this is not a second root: it is
   * the shell's own folder, which "Open terminal here" and a plain `cd` inside
   * the root both move without moving the tab. Restoring the shell at the root
   * instead put it somewhere the user had deliberately left - and, worse, sent
   * the agent resume to look up the ROOT's newest session, so a conversation
   * held in a subfolder came back as the wrong conversation.
   *
   * Kept only when it is the root or inside it, checked on the way out of the
   * file as well as on the way in: it is a spawn folder, and the wall's own
   * `term:spawn` check would refuse anything else anyway.
   */
  cwd?: string
  /** The shell hosted a CLAUDE session when the strip was saved: restore may
   *  resume it (`claude --continue` rebuilds the conversation per folder). */
  /** Which agent the shell hosted at quit, so the right resume runs. The
   *  legacy `true` from before codex could resume means claude. */
  agent?: 'claude' | 'codex'
  /**
   * The folders that were OPEN in this tab's tree.
   *
   * A tab is a root and a current file (2026-08-20), and this is deliberately
   * not a per-tab SETTING - it is where you had got to. Closing Prism used to
   * collapse the whole tree, so reopening on a file six folders down showed it
   * in the viewer with nothing marked in the sidebar, because none of the rows
   * leading to it existed yet.
   *
   * Capped, because it is a suggestion and not a record: a tree somebody has
   * opened a thousand folders in is not worth carrying, and the ancestors of
   * the current file are re-derived on restore regardless.
   */
  open?: string[]
}

export interface SavedTabs {
  tabs: SavedTab[]
  /** Index into `tabs` of the one that was in front. */
  active: number
}

const NONE: SavedTabs = { tabs: [], active: 0 }

/** Is `p` the folder `root` or somewhere inside it? Lower-cased first, since
 *  these are Windows paths and two spellings are one folder; `relative` is a
 *  plain string comparison and would call C:\Foo and C:\foo strangers. */
const inside = (root: string, p: string): boolean => {
  const rel = relative(resolve(root.toLowerCase()), resolve(p.toLowerCase()))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

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
  // The active tab is tracked by POSITION through the filtering, not re-found
  // by root afterwards: two tabs on one folder are legal (the strip's + allows
  // them), and a root lookup would always crown the first twin.
  let active = -1
  list.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object') return
    const { root, file, term, agent, cwd } = entry as {
      root?: unknown
      file?: unknown
      term?: unknown
      agent?: unknown
      cwd?: unknown
    }
    if (typeof root !== 'string' || !isFolder(root)) return
    const tab: SavedTab = typeof file === 'string' && existsSync(file) ? { root, file } : { root }
    if (term === 'full' || term === 'split') {
      tab.term = term
      // Only meaningful with a terminal. `true` is the old spelling of claude.
      if (agent === true || agent === 'claude') tab.agent = 'claude'
      else if (agent === 'codex') tab.agent = 'codex'
      // The shell's own folder, kept only while it still exists and is still
      // inside the root: a folder renamed since is not a shell's cwd, it is a
      // spawn that fails, and the root is the honest fallback.
      if (typeof cwd === 'string' && inside(root, cwd) && isFolder(cwd)) tab.cwd = cwd
    }
    if (i === wasActive) active = tabs.length
    tabs.push(tab)
  })
  // The tab that was in front is gone (or the index named nowhere): follow its
  // root to a surviving twin, else fall back to the first tab.
  if (active < 0)
    active = Math.max(
      0,
      tabs.findIndex((t) => t.root === activeRoot)
    )
  return { tabs, active }
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
