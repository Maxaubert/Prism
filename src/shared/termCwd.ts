/**
 * The terminal and the sidebar in step (2026-09-04, #99). Pure, shared by
 * main (which composes the one command it writes) and the renderer (which
 * reads the shell's reports and decides what the tree does with them).
 *
 * The shell tells Prism where it is the way it tells Windows Terminal: its
 * PROMPT prints `ESC ] 9 ; 9 ; <path> ESC \` (OSC 9;9). That is the only
 * source: pwsh's process cwd does not follow Set-Location, so asking the
 * process is wrong on Windows, and a report from the prompt is by definition
 * current only at an idle prompt - which is exactly when it is safe to act on.
 */

/** A drive path (`C:\x`) or a UNC path (`\\srv\share`), nothing else. */
const ABS = /^(?:[A-Za-z]:[\\/]|\\\\[^\\/])/

/**
 * The path out of an OSC 9 payload as xterm hands it over: everything after
 * the `9;` selector, so a Windows Terminal report arrives as `9;C:\path`.
 * Null for any other OSC 9 (ConEmu's progress bar rides the same number).
 */
export function parseOsc9(data: string): string | null {
  if (!data.startsWith('9;')) return null
  let p = data.slice(2).trim()
  // pwsh's prompt may quote the path; a folder cannot contain a quote.
  if (p.length > 1 && p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1)
  return ABS.test(p) ? p : null
}

const norm = (p: string): string => p.replace(/[\\/]+/g, '\\').replace(/\\$/, '').toLowerCase()

/**
 * Where a cwd stands against the tab's root. `same` is the root itself;
 * `inside` is a folder the tree can show; `outside` is past the wall, where
 * only a reroot shows anything true.
 */
export function decideFollow(root: string, cwd: string): 'same' | 'inside' | 'outside' {
  const r = norm(root)
  const c = norm(cwd)
  if (!r || !c) return 'outside'
  if (r === c) return 'same'
  return c.startsWith(r + '\\') ? 'inside' : 'outside'
}

/**
 * The change-directory line for a shell, ending in Enter, or null for a shell
 * Prism does not write into (WSL, bash: they report nothing either). Written
 * ONLY at an idle prompt with nothing typed (the renderer's guard). pwsh takes
 * the literal path, single-quoted with quotes doubled; cmd needs `/d` to cross
 * drives, and a Windows path cannot hold a double quote, so none is escaped.
 */
export function cdCommand(shellId: string | undefined, path: string): string | null {
  if (!path) return null
  if (shellId === 'pwsh' || shellId === 'powershell')
    return `Set-Location -LiteralPath '${path.replace(/'/g, "''")}'\r`
  if (shellId === 'cmd') return `cd /d "${path}"\r`
  return null
}
