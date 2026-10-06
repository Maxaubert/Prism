/**
 * WHICH SIDEBAR PLACE IS MARKED (#296; owner, 2026-10-06: "in file explorer it
 * works like this when you're in a subfolder from the sidebar, i think its
 * based on whether you clicked the pin first then went from there"). Before,
 * every place whose path equalled the folder was marked, so a folder pinned
 * AND open as a project lit two rows, and a subfolder lit none. Now File
 * Explorer's rule: the place you CLICKED stays marked while the folder is it
 * or anything beneath it; else the first place whose path IS the folder; else
 * none. Pure, so the rule is tested apart from the panel.
 */

const key = (path: string): string => path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()

/** True when `folder` is `root` or anywhere beneath it. */
export function withinFolder(folder: string, root: string): boolean {
  const f = key(folder)
  const r = key(root)
  return !!r && (f === r || f.startsWith(`${r}\\`))
}

export interface PlaceRow {
  /** The row's own key (`pin:<path>` or `place:<path>`): one path can be two rows. */
  row: string
  path: string
}

/** The one marked row, or null. `chosen` is the row last clicked, if any. */
export function markedPlace(
  rows: PlaceRow[],
  folder: string,
  chosen: PlaceRow | null
): string | null {
  if (chosen && withinFolder(folder, chosen.path) && rows.some((r) => r.row === chosen.row))
    return chosen.row
  return rows.find((r) => key(r.path) === key(folder))?.row ?? null
}
