import type { DirListing, ViewerFile } from '@shared/types'
import { browsableArchive } from '@shared/archivePlace'

/**
 * THE TREE, AS THE ROWS IT PAINTS (2026-09-28; owner: "prism is super slow i
 * click and it takes like 3 seconds for it to react").
 *
 * The tree rendered EVERY row it held, nested, and every row re-rendered on
 * every navigation. MEASURED in the owner's Prism: 47,816 rows (AppData\Local\
 * Temp was open), 382,000 elements in the page, and each folder switch was a
 * 700 ms and a 500 ms block of the renderer, which is what a click waited
 * behind and what "Loading folder…" was shown through. So the tree is a flat
 * list of the rows it would show, and only the ones in view are drawn
 * (`treeWindow`). This is that list: folders, files and the muted notes
 * ("loading…", "empty", "can't read this folder"), in exactly the order the
 * nested tree drew them, which is also the order `visibleRows` walks for the
 * keyboard. Pure.
 */
export type PaintRow =
  | {
      kind: 'folder'
      key: string
      path: string
      name: string
      depth: number
      /** An ARCHIVE drawn as a folder (#300; owner: "this would work the same
       *  in project mode"): it expands like one, keeps its icon, and its menu
       *  is the archive's. */
      zip?: ViewerFile
    }
  | { kind: 'file'; key: string; path: string; name: string; depth: number; file: ViewerFile }
  | { kind: 'note'; key: string; text: string; depth: number }

/** What a folder with nothing to show says. "empty" is a claim about the
 *  FOLDER, so a folder of files Prism cannot open says that instead. */
function emptyText(listing: DirListing): string {
  return listing.hidden
    ? `${listing.hidden} file${listing.hidden === 1 ? '' : 's'} Prism can't open`
    : 'empty'
}

export function paintRows(
  root: string,
  expanded: ReadonlySet<string>,
  children: Readonly<Record<string, DirListing>>,
  opts: {
    orderFiles: (files: ViewerFile[]) => readonly ViewerFile[]
    /** Folders follow the sort direction only when the field is name. */
    foldersReversed: boolean
  }
): PaintRow[] {
  const out: PaintRow[] = []
  const seen = new Set<string>() // a symlink loop must not hang the tree
  const walk = (dir: string, depth: number): void => {
    if (seen.has(dir.toLowerCase())) return
    seen.add(dir.toLowerCase())
    const listing = children[dir]
    if (!listing) {
      out.push({ kind: 'note', key: `${dir}\0loading`, text: 'loading…', depth })
      return
    }
    if (listing.unreadable) {
      out.push({ kind: 'note', key: `${dir}\0unreadable`, text: "can't read this folder", depth })
      return
    }
    if (!listing.folders.length && !listing.files.length) {
      out.push({ kind: 'note', key: `${dir}\0empty`, text: emptyText(listing), depth })
      return
    }
    const folders = opts.foldersReversed ? [...listing.folders].reverse() : listing.folders
    for (const f of folders) {
      out.push({ kind: 'folder', key: f.path, path: f.path, name: f.name, depth })
      if (expanded.has(f.path)) walk(f.path, depth + 1)
    }
    for (const f of opts.orderFiles([...listing.files])) {
      if (isZipNode(f)) {
        out.push({ kind: 'folder', key: f.path, path: f.path, name: f.name, depth, zip: f })
        if (expanded.has(f.path)) walk(f.path, depth + 1)
      } else out.push({ kind: 'file', key: f.path, path: f.path, name: f.name, depth, file: f })
    }
  }
  walk(root, 0)
  return out
}

/** A file the tree draws as a folder: an archive (#300). */
export function isZipNode(f: { name: string; kind?: string }): boolean {
  return (f.kind === undefined || f.kind === 'archive') && browsableArchive(f.name)
}

/** Rows drawn beyond each edge of the view, so a scroll never shows a gap. */
export const OVERSCAN = 12

/** The slice of `count` rows of height `rowH` that a view of `viewH` pixels,
 *  scrolled `scrollTop` into the list, shows: `[first, end)`. */
export function treeWindow(
  count: number,
  rowH: number,
  scrollTop: number,
  viewH: number,
  overscan = OVERSCAN
): { first: number; end: number } {
  if (!count || rowH <= 0) return { first: 0, end: 0 }
  const top = Math.max(0, Math.floor(scrollTop / rowH) - overscan)
  const bottom = Math.ceil((scrollTop + Math.max(0, viewH)) / rowH) + overscan
  return { first: Math.min(top, count), end: Math.min(count, Math.max(top, bottom)) }
}

/**
 * Where to scroll so row `index` is in view, by the rule the tree always
 * followed (`revealRow` in Sidebar, which measured an element that may now not
 * exist): a row on screen is only nudged, once it comes within a few rows of
 * an edge; a row off screen is placed near the top with that context above
 * it. `listTop` is where the list starts inside the scroller. Returns the new
 * scrollTop, or null when the row is already comfortably in view.
 */
export function scrollForRow(
  index: number,
  rowH: number,
  listTop: number,
  scrollTop: number,
  viewH: number,
  scrollHeight: number
): number | null {
  if (index < 0 || !viewH) return null
  const top = listTop + index * rowH
  const bottom = top + rowH
  const margin = Math.min(Math.max(rowH * 3, 40), viewH * 0.35)
  const viewBottom = scrollTop + viewH
  let next: number
  if (bottom <= scrollTop || top >= viewBottom) next = top - margin
  else if (top < scrollTop + margin) next = top - margin
  else if (bottom > viewBottom - margin) next = bottom - viewH + margin
  else return null
  next = Math.max(0, Math.min(next, scrollHeight - viewH))
  return Math.abs(next - scrollTop) < 1 ? null : next
}
