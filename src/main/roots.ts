import { isInsideRoot, isRoot } from './dirList'

/**
 * The roots the user has open, and the wall built on them.
 *
 * This was one module-level string in index.ts, guarding sixteen IPC handlers.
 * Tabs make it a set, which widens the wall from one folder to N - but only to
 * folders the user explicitly opened, which is exactly what a tab is.
 *
 * Two checks, because the handlers are not all the same shape:
 *   - `validRoot(root, p)` is the strict, per-tab one. The renderer names the
 *     root it is acting in, and both the root and the path have to hold up. The
 *     navigation handlers use this: they are per-tab operations and the renderer
 *     always knows which tab asked.
 *   - `insideAnyRoot(p)` is for everything else - file operations, media,
 *     properties. They act on a path the user can already see, and threading a
 *     tab id through CodeView's save buys nothing.
 */

const roots: string[] = []

/**
 * Told whenever the set changes, so the folder watcher can follow it.
 *
 * A subscriber rather than an fs call here: this module is the authority on
 * WHICH folders are open, and knows nothing about watching them. The watcher
 * set is then exactly the root set by construction - it can never drift onto
 * a path the renderer named.
 */
type RootListener = (root: string, open: boolean) => void
let listener: RootListener | null = null
export function onRootsChanged(fn: RootListener | null): void {
  listener = fn
}

/** Roots in the order they were opened. */
export function openRoots(): readonly string[] {
  return roots
}

/** Open a root, or move on quietly if it is already open. Case and a trailing
 *  separator do not make a second root: Windows would call them the same folder
 *  and so does the wall. */
export function addRoot(root: string): void {
  if (!root || roots.some((r) => isRoot(r, root))) return
  roots.push(root)
  listener?.(root, true)
}

/** Close a root. Nothing beneath it is reachable afterwards. */
export function dropRoot(root: string): void {
  const i = roots.findIndex((r) => isRoot(r, root))
  if (i >= 0) {
    const gone = roots[i]
    roots.splice(i, 1)
    listener?.(gone, false)
  }
}

/** True when `p` sits in any open root. The general wall. */
export function insideAnyRoot(p: string): boolean {
  return roots.some((r) => isInsideRoot(r, p))
}

/** True when `p` IS one of the open roots, which nothing may rename or bin:
 *  it would pull the ground out from under a tab. */
export function isAnyRoot(p: string): boolean {
  return roots.some((r) => isRoot(r, p))
}

/** The strict check: `p` is inside `root`, AND `root` is genuinely open. A
 *  renderer that names a root it never opened gets nothing. */
export function validRoot(root: string, p: string): boolean {
  return roots.some((r) => isRoot(r, root)) && isInsideRoot(root, p)
}

/** Tests only: forget every root. */
export function resetRoots(): void {
  roots.length = 0
}
