import { browsableArchive, placeOf } from '@shared/archivePlace'

/**
 * WHERE A ROW OF THE ZIP CARD GOES (#483; owner, 2026-11-06): the card's rows
 * are the top of what is inside, and a click on one does what a double-click
 * on that row does in the Explorer once inside the zip. A folder, or a zip
 * inside the zip, is gone INTO (the Explorer walks there); a file opens in the
 * viewer. The path is the row's place inside the container, under the one top
 * folder when the card shows "Inside, in <top>".
 */
export interface CardRowTarget {
  go: 'folder' | 'file'
  path: string
}

export function cardRowTarget(
  container: string,
  top: string | null,
  row: { name: string; dir: boolean }
): CardRowTarget {
  const path = placeOf(container, top ? `${top}/${row.name}` : row.name)
  return { go: row.dir || browsableArchive(row.name) ? 'folder' : 'file', path }
}
