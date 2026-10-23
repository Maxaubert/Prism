import { HELP_KEYS } from '../lib/helpPrefs'
import type { SettingsSectionId } from './sectionIds'

/**
 * EVERY COMMAND-HELP OPTION, BY ID (#12): the same deal `options.ts` makes for
 * the terminal's and `dictationOptions.ts` for dictation's. The row renders as
 * `data-pref="<id>"`, and each app's e2e asserts that its page shows this list.
 *
 * A list of its own, of one, rather than a row in `TERMINAL_OPTIONS`: Prism's
 * terminal parity check reads THAT file as text, so a row added there would
 * turn Prism's gate red until Prism had wired the panel. A host that has not
 * wired it simply does not read this file yet.
 */
export interface HelpOption {
  id: string
  label: string
  type: 'switch'
  /** The localStorage key behind it. Same key in both apps, separate stores. */
  key: string
  /** As in `options.ts`. */
  section: SettingsSectionId
  icon: string
  sub: string
  keywords?: string
}

export const HELP_OPTIONS: readonly HelpOption[] = [
  { id: 'help-enabled', label: 'Command help', type: 'switch', key: HELP_KEYS.enabled, section: 'help', icon: 'search', sub: 'Find a command by describing it.', keywords: 'cheat sheet commands lookup shell' }
]
