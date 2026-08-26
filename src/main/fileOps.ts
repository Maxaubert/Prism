import { existsSync, renameSync } from 'fs'
import { dirname, extname, join } from 'path'
import type { OnClash, RenameResult } from '@shared/types'

// Renaming files. Deliberately free of electron imports so it can be unit-tested;
// the one thing it can't do alone is bin a file, which main passes in as `trash`.

// What Windows refuses in a filename: these characters, and control characters.
// eslint-disable-next-line no-control-regex
const INVALID = new RegExp('[<>:"/\\\\|?*\x00-\x1f]')
// Reserved device names, with or without an extension.
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i

/** Why Windows would refuse this name, or null if it's fine. */
export function nameError(name: string): string | null {
  const n = name.trim()
  if (!n) return 'Give the file a name.'
  if (n === '.' || n === '..') return 'That name is reserved.'
  if (INVALID.test(n)) return 'A name cannot contain \\ / : * ? " < > |'
  if (RESERVED.test(n)) return `"${n}" is a name Windows reserves.`
  if (n.endsWith('.')) return 'A name cannot end with a full stop.'
  if (n.length > 255) return 'That name is too long.'
  return null
}

/** Two paths that differ only in capitalisation are the same file on Windows. */
const sameFile = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/**
 * "photo.jpg" -> "photo (2).jpg", counting up until the folder has no such file.
 * The suffix goes before the extension, the way Explorer does it.
 */
export function uniqueName(dir: string, name: string): string {
  if (!existsSync(join(dir, name))) return name
  const ext = extname(name)
  const stem = ext ? name.slice(0, -ext.length) : name
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${stem} (${i})${ext}`
    if (!existsSync(join(dir, candidate))) return candidate
  }
  return `${stem} (${Date.now()})${ext}`
}

/**
 * Rename a file within its folder. With `ask` (the default) a name that's taken
 * comes back as a clash plus the name "keep both" would use, so the caller can
 * put the choice to the user rather than guessing. Overwriting bins the file it
 * replaces rather than destroying it.
 */
export async function renameFile(
  path: string,
  name: string,
  onClash: OnClash,
  trash: (p: string) => Promise<void>
): Promise<RenameResult> {
  const bad = nameError(name)
  if (bad) return { ok: false, reason: 'invalid', message: bad }
  if (!existsSync(path)) return { ok: false, reason: 'missing' }

  const dir = dirname(path)
  const wanted = name.trim()
  let target = join(dir, wanted)
  // A name is a name, never a route: whatever it contains, the file stays in the
  // folder it was in. The character check above should already forbid this.
  if (dirname(target) !== dir) return { ok: false, reason: 'invalid', message: 'A name cannot contain a folder path.' }

  // Changing only the capitalisation of the same file isn't a clash.
  let replaced: string | undefined
  if (existsSync(target) && !sameFile(target, path)) {
    if (onClash === 'ask') return { ok: false, reason: 'clash', suggestion: uniqueName(dir, wanted) }
    if (onClash === 'keep-both') target = join(dir, uniqueName(dir, wanted))
    else {
      replaced = target
      await trash(target)
    }
  }

  try {
    renameSync(path, target)
    return { ok: true, path: target, replaced }
  } catch (e) {
    return { ok: false, reason: 'failed', message: e instanceof Error ? e.message : String(e) }
  }
}
