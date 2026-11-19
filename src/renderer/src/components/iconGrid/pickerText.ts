import { plural } from '../../lib/emptyText'

/** What a screen reader calls the search field and the grid (pinned by the
 *  dialog's test). */
export const ICON_SEARCH_LABEL = 'Search icons'
export const ICON_GRID_LABEL = 'Icons'

/** The status line under the grid. */
export function iconStatus(total: number, shown: number, searching: boolean): string {
  if (!searching) return plural(total, 'icon')
  if (!shown) return 'No icon matches'
  return plural(shown, 'match', 'matches')
}
