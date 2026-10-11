/**
 * THE TITLE BAR'S MORE MENU: what the three dots in the title bar open (a
 * click, not a right-click). Opened by App (`moreMenu`, toggled by
 * `toggleMore`).
 */
import type { MenuItem } from '../components/ContextMenu'

export interface MoreMenuContext {
  /** Open the phone dialog. */
  openPhone: () => void
}

export function titleBarMoreMenu(ctx: MoreMenuContext): MenuItem[] {
  // One row per thing that is not about the open file (#272: "multiple
  // things, remote just being one of them"). Phone stays first; a new
  // row is one more entry here.
  return [{ label: 'Phone', onPick: ctx.openPhone }]
}
