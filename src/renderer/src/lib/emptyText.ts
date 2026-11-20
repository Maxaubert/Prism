/**
 * HOW A COUNT, A PLURAL AND AN EMPTY LIST ARE WORDED (#509; owner, 2026-11-19).
 * One module, so "12,000 items" reads the same in the status bar, the Recycle
 * Bin strip, the Empty dialog and Properties. Thousands are always written the
 * en-US way, never by the machine's locale, the way `count` in Properties
 * already did.
 */

/** 12345 -> "12,345": a locale-independent thousands format. */
export function count(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

/** "1 item", "12,000 items"; `many` for a noun that is not just + "s". */
export function plural(n: number, noun: string, many = `${noun}s`): string {
  return `${count(n)} ${n === 1 ? noun : many}`
}

/**
 * What a place holds: files first, then folders, the order Explorer and the
 * archive panel use. A folder part only when there is one ("3 files",
 * "3 files, 1 folder").
 */
export function contents(files: number, folders: number): string {
  return folders > 0 ? `${plural(files, 'file')}, ${plural(folders, 'folder')}` : plural(files, 'file')
}

/** A search that found nothing, in the folder it looked in. */
export const NO_MATCHES = 'No matching items in this folder or its subfolders.'
/** A search cut short before it found anything. */
export const NO_MATCHES_STOPPED = 'No matches found before the search stopped. Refine your search and try again.'
export const EMPTY_FOLDER = 'This folder is empty.'
export const EMPTY_ARCHIVE = 'This archive is empty.'