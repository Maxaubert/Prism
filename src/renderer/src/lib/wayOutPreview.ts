import { browseParent } from './browse'

/** Windows folder identity, including equivalent slash and trailing-slash forms. */
function key(path: string): string {
  return path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

/**
 * OUT OF A ZIP, ITS PREVIEW COMES BACK (#334; owner, 2026-10-09: "when you go
 * back again you should see the zip in the preview since the main view is now
 * just a different folder"). Going into a zip empties the pane (#300 review,
 * `leaveShown`): the list shows its contents and the card beside them was the
 * double view. Coming back out to the folder that holds it (Back, Up, a crumb)
 * marks the zip, the way out (`arrivalMark`), and the list is another folder
 * again, so the zip's card is no double: the pane shows it.
 *
 * Only the way out, and only a FILE row: the mark is the place you came from,
 * which is a folder (nothing to preview) unless it was an archive. A shut pane
 * stays shut, and nothing else is previewed on its own.
 */
export function wayOutPreview<T extends { path: string }>(arrival: {
  /** The place the Explorer was in before this arrival. */
  from: string | null
  /** The place it arrived at. */
  to: string
  /** The row marked there. */
  selected: string | null
  /** Whether the preview pane is on. */
  preview: boolean
  /** The files of the folder arrived at. */
  files: readonly T[]
}): T | null {
  const { from, to, selected, preview, files } = arrival
  if (!preview || !from || !selected || key(selected) !== key(from)) return null
  const parent = browseParent(from.replace(/\//g, '\\').replace(/\\+$/, ''))
  if (!parent || key(parent) !== key(to)) return null
  return files.find((file) => key(file.path) === key(selected)) ?? null
}
