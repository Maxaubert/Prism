/**
 * THE ONE NORMALISER FOR A RENAME (#523, owner 2026-11-19): what was typed,
 * trimmed, or null when it is a Cancel (empty, or the same name as before).
 * Every rename field answers through this, so no path takes a padded name or
 * renames a file to itself.
 */
export function renamedTo(current: string, typed: string): string | null {
  const next = typed.trim()
  return next && next !== current ? next : null
}
