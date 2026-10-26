/**
 * WHAT A FOLDER IS CALLED, once (audit 2026-10-12: four places split a path
 * their own way). Either separator, any number of them, a trailing one or not.
 * How a name and its parent are JOINED stays each place's own: a tab reads
 * "api - site", a menu row "api  ·  site".
 */

/** The path's folders, root first. */
export const pathParts = (p: string): string[] => p.split(/[\\/]+/).filter(Boolean)

/** The last segment. A drive root has only its letter, so `D:\` reads `D:`. */
export const baseName = (p: string): string => pathParts(p).at(-1) ?? p

/** The parent folder's name, or '' at a root. */
export const parentName = (p: string): string => pathParts(p).at(-2) ?? ''
