import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Is this folder OUR Claude Code plugin (#131)? The app inherits whatever
 * started it: launched from a tab of another copy (the owner's stable copy,
 * a dev build), its environment already names that copy's plugin. Passed on,
 * every Claude would run two of them, and with the setting off, one would still
 * be there. So a shell's environment drops every folder that holds a plugin of
 * this name and adds the one this app ships, if any.
 */
export const PLUGIN_NAME = 'prism-terminal-status'

const seen = new Map<string, boolean>()

export function isOurPlugin(dir: string): boolean {
  const key = dir.trim().toLowerCase()
  const known = seen.get(key)
  if (known !== undefined) return known
  let ours = false
  try {
    const m = JSON.parse(readFileSync(join(dir.trim(), '.claude-plugin', 'plugin.json'), 'utf8')) as { name?: unknown }
    ours = m.name === PLUGIN_NAME
  } catch {
    /* not a plugin, or not there: the user's, left alone */
  }
  seen.set(key, ours)
  return ours
}
