import type { MenuItem } from '../components/ContextMenu'
import { clipboardText } from '../lib/clipboardText'

/**
 * THE ADDRESS BAR'S MENU (owner, 2026-09-22: "let me right click the url bar
 * to get options to copy path or copy as text, like File Explorer"): what the
 * user right-clicks on the Explorer's and the file viewer's address field
 * (`components/browse/BrowseToolbar.tsx`), always for the folder shown, wherever
 * on the bar the click landed (owner, 2026-10-27: "it should always copy the
 * full path to the active folder you're in"; a crumb's menu used to act on
 * that crumb's folder).
 */

export interface AddressBarMenuContext {
  /** The folder the menu is for. */
  path: string
  /** Turns the crumbs into the editable path field (Ctrl+L). */
  onEdit: () => void
}

export function addressBarMenu(ctx: AddressBarMenuContext): MenuItem[] {
  return [
    // Explorer's own words and pair: the folder itself (a paste in
    // Explorer takes the folder, a paste in text takes the path), and
    // the path as plain text.
    { label: 'Copy address', onPick: () => void window.prism.copyAddress(ctx.path) },
    { label: 'Copy address as text', onPick: () => void clipboardText(ctx.path) },
    { label: 'Edit address', hint: 'Ctrl+L', onPick: ctx.onEdit }
  ]
}
