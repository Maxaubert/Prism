// The look of a popup menu, one for both (#522): the right-click menu and the
// player's cog menu wear the same panel (radius, border, flat colour, shadow)
// and the same row (28 px, 12 px type, a divider above every row but the
// first). Each adds its own size and position around these.

/** The panel's surface. Flat colour: --p-title is translucent on glass styles,
 *  and a menu you can read the file names through is noise, not material. */
export const MENU_PANEL =
  'overflow-x-hidden overflow-y-auto overscroll-contain rounded-[2px] border border-[color:var(--p-divider)] bg-[var(--p-raised)] shadow-[0_10px_28px_rgba(0,0,0,.5)]'

/** A row's box: height, type, padding and the divider above it. */
export const MENU_ROW =
  'flex h-[28px] w-full items-center justify-between border-t border-[color:var(--p-divider)] px-[11px] text-left text-[12px] transition-colors first:border-t-0 disabled:cursor-default disabled:opacity-50'

/** A row's ordinary ink and hover. */
export const MENU_ROW_INK =
  'text-[var(--p-text-soft)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]'

/** The red of a danger row and an error line (audit #39). Mixed with the theme's own ink, like the delete
 *  question's outline, so it reads on a light panel as well as a dark one. */
export const DANGER_INK = 'text-[color-mix(in_srgb,#b4353f_70%,var(--p-text))]'

/** A danger row's ink and hover: a red wash that stays visible on any panel. */
export const MENU_ROW_DANGER =
  DANGER_INK + ' hover:bg-[color-mix(in_srgb,#b4353f_16%,transparent)] hover:text-[color-mix(in_srgb,#b4353f_80%,var(--p-text))]'

/** Which row an arrow key lands on, wrapping at both ends. t is -1 when
 *  no row has the focus: Down takes the first, Up the last. */
export function stepRow(count: number, at: number, key: 'ArrowDown' | 'ArrowUp'): number {
  if (count <= 0) return -1
  if (at < 0) return key === 'ArrowDown' ? 0 : count - 1
  return (at + (key === 'ArrowDown' ? 1 : -1) + count) % count
}
