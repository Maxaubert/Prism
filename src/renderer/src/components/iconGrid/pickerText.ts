/** What a screen reader calls the search field and the grid (pinned by the
 *  dialog's test). */
export const ICON_SEARCH_LABEL = 'Search icons'
export const ICON_GRID_LABEL = 'Icons'

const count = (n: number): string => n.toLocaleString('en-US')

/** The status line under the grid. */
export function iconStatus(total: number, shown: number, searching: boolean): string {
  if (!searching) return `${count(total)} icons`
  if (!shown) return 'No icon matches'
  return shown === 1 ? '1 match' : `${count(shown)} matches`
}
