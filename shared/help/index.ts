import { AGENTS_HELP } from './agents'
import { BASH_HELP } from './bash'
import { CMD_HELP } from './cmd'
import { GIT_HELP } from './git'
import { PACKAGES_HELP } from './packages'
import { POWERSHELL_HELP } from './powershell'
import { WSL_HELP } from './wsl'
import type { HelpCategory, HelpEntry } from './types'
import { shownIn, type HelpShellChoice } from './shells'

/**
 * THE HELP CATALOGUE, WHOLE (#12). Six files, one list: a file per command
 * language, plus the three that read the same in every shell (git, the agents'
 * own CLIs, the package managers).
 *
 * ONE CONSTANT ARRAY, and that is load-bearing: the search builds its index
 * once per array and finds it again by identity, so a list joined afresh on
 * every call would be indexed afresh on every keystroke.
 *
 * `catalogue.test.ts` is the gate for everything in here: ids, prefixes,
 * keywords, placeholders, and a `danger` line on anything destructive. A new
 * entry is added to the file of its shell and is not done until that passes.
 */
export const ALL_HELP: readonly HelpEntry[] = [
  ...POWERSHELL_HELP,
  ...CMD_HELP,
  ...BASH_HELP,
  ...GIT_HELP,
  ...AGENTS_HELP,
  ...PACKAGES_HELP,
  ...WSL_HELP
]

/** The id prefix an entry of each shell wears, held by the catalogue test.
 *  'any' has three, one per file, since the prefix there names the TOOL. */
export const HELP_ID_PREFIXES: Readonly<Record<HelpShellChoice, string>> = {
  powershell: 'ps-',
  cmd: 'cmd-',
  bash: 'sh-'
}

/**
 * The order the categories are browsed in with an empty query: the everyday
 * first (where am I, what is here), the tools a developer reaches for next,
 * and the shell's own housekeeping last.
 */
export const HELP_CATEGORIES: ReadonlyArray<{ id: HelpCategory; name: string }> = [
  { id: 'folders', name: 'Folders' },
  { id: 'files', name: 'Files' },
  { id: 'text', name: 'Text and search' },
  { id: 'processes', name: 'Processes and ports' },
  { id: 'network', name: 'Network' },
  { id: 'system', name: 'System' },
  { id: 'git', name: 'Git' },
  { id: 'agents', name: 'Claude Code and Codex' },
  { id: 'packages', name: 'Installing things' },
  { id: 'wsl', name: 'WSL (Linux on Windows)' },
  { id: 'shell', name: 'The shell itself' }
]

/** What one shell's reader is offered: its own entries and every 'any' one,
 *  in catalogue order. */
export function helpFor(shell: HelpShellChoice): HelpEntry[] {
  return ALL_HELP.filter((e) => shownIn(e.shell, shell))
}

/**
 * A "command" that is a KEY TO PRESS, not text to paste: `Ctrl+C`, `Esc`,
 * `Shift+Tab`. The catalogue holds a handful, because "how do I stop this" is
 * one of the first things anybody asks. The panel draws them as key caps and
 * gives them NO copy button: the characters "Ctrl+C" on a clipboard are of no
 * use to anyone, and pasted into a shell they are a command that fails.
 */
export function isKeyPress(command: string): boolean {
  return /^(?:(?:Ctrl|Alt|Shift|Win)\+)*(?:[A-Z]|Esc|Tab|Enter|Space|Backspace|F\d{1,2})$/.test(command)
}

export { HELP_SHELLS, shellOfShellId, shownIn, variantsIn, type HelpShellChoice } from './shells'
export type { HelpCategory, HelpEntry, HelpShell } from './types'
