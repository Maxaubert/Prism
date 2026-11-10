/**
 * THE RECYCLE BIN AS A PLACE (Recycle Bin feature, D5; owner, 2026-11-10: "add
 * recycle bin to the bottom of the explorer page").
 *
 * One fixed string names it: Windows' own name for the bin. It is deliberately
 * NOT an absolute path, so every `isAbsolute` guard (the walls, the file ops,
 * `browse:watch`, the listing cache, the search, the drag-out) refuses it by
 * default and fails closed. The places that must accept it are few, listed in
 * the spec, and each says so.
 */
export const BIN_PLACE = 'shell:RecycleBinFolder'

/** What the crumb, the tab and the row call it. */
export const BIN_NAME = 'Recycle Bin'

/** Is `p` the bin place (the sentinel, in any case)? */
export function isBinPlace(p: unknown): boolean {
  return typeof p === 'string' && p.toLowerCase() === BIN_PLACE.toLowerCase()
}

/**
 * Typed text that means the bin: `Recycle Bin` or Windows' `shell:RecycleBinFolder`,
 * in any case, with the quotes and spaces a paste brings. Null for anything else.
 */
export function binPlaceOf(text: string): string | null {
  const t = text
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .trim()
    .toLowerCase()
  return t === BIN_NAME.toLowerCase() || t === BIN_PLACE.toLowerCase() ? BIN_PLACE : null
}
