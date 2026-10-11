import type { SettingsSectionId } from './sectionIds'

/**
 * EVERY TERMINAL OPTION, BY ID (#15). The owner's rule: the two apps' terminal
 * settings are the same settings ("the setting names, types, how they
 * function"); only the personal values differ. The shared sections render
 * these rows as `data-pref="<id>"`, and each app has a PARITY TEST asserting
 * that what it shows is this list, so an option can never exist in one app and
 * not the other without a test going red.
 *
 * `hosts` names where a row legitimately does not appear, and why.
 */
export interface TerminalOption {
  id: string
  label: string
  type: 'choice' | 'switch' | 'range' | 'colour' | 'theme'
  /** The localStorage key behind it. Same key in both apps, separate stores. */
  key: string
  /** Absent = every host. No row uses it since the Opacity slider went
   *  (#114); kept, since each host's parity check reads it. */
  onlyWhere?: 'the terminal owns the window acrylic'
  /** The section that draws it (`SETTINGS_SECTIONS`). */
  section: SettingsSectionId
  /** Its tile (`layout/icons.ts`). */
  icon: string
  /** Its subtext at rest, which is also what Find a setting reads. At most
   *  eight plain words; the row may say a live state in its place. */
  sub: string
  /** Words nobody sees that should still find it. */
  keywords?: string
}

/** In DISPLAY ORDER (owner, 2026-09-22: the two apps' terminal settings "the
 *  same in terms of order"). Since the grouped cards redesign (2026-10-05)
 *  the order is checked PER SECTION: each app's e2e reads every core section
 *  top to bottom against this list; which page holds a section is the host's.
 *
 *  FLAT ENTRIES, ONE LINE EACH, NO BRACE INSIDE ONE: Prism's gate reads this
 *  file as text, an entry being `{ id: '...' ... }` up to its first closing
 *  brace (a core test holds it). */
export const TERMINAL_OPTIONS: readonly TerminalOption[] = [
  { id: 'term-shell', label: 'Default shell', type: 'choice', key: 'prism.term.shell', section: 'shell', icon: 'shell', sub: 'New terminals start with this shell.', keywords: 'powershell pwsh cmd command prompt bash wsl' },
  { id: 'term-font-family', label: 'Terminal font', type: 'choice', key: 'prism.term.font', section: 'text', icon: 'font', sub: 'The typeface inside every terminal.', keywords: 'typeface face monospace cascadia consolas' },
  { id: 'term-font', label: 'Terminal text size', type: 'choice', key: 'prism.term.fontPct', section: 'text', icon: 'size', sub: 'Text size for every terminal.', keywords: 'font zoom bigger smaller scale' },
  { id: 'agent-indicator', label: 'Agent working indicator', type: 'choice', key: 'prism.term.agentIndicator', section: 'marks', icon: 'working', sub: 'A line under the tab while it works.', keywords: 'claude codex busy minimal full mark ring spinner solid fill' },
  { id: 'agent-done-on', label: 'Mark tabs when an agent finishes', type: 'switch', key: 'prism.term.agentDoneOn', section: 'marks', icon: 'done', sub: 'Stays until you open the tab.', keywords: 'finished complete done indicator' },
  { id: 'agent-question-on', label: 'Mark tabs when an agent asks', type: 'switch', key: 'prism.term.agentQuestionOn', section: 'marks', icon: 'ask', sub: 'Stays until you answer or open it.', keywords: 'question waiting answer indicator' },
  // Claude Code's own word through its hooks (#131): a Failed mark, and the
  // switch that hands new shells the plugin which tells it.
  { id: 'agent-failed-on', label: 'Mark tabs when an agent fails', type: 'switch', key: 'prism.term.agentFailedOn', section: 'marks', icon: 'fail', sub: 'When it stops on an error.', keywords: 'failed error crash stopped indicator' },
  { id: 'agent-hooks', label: 'Exact status from Claude Code', type: 'switch', key: 'prism.term.agentHooks', section: 'claude', icon: 'hook', sub: 'Applies to terminals opened after a change.', keywords: 'hooks plugin status anthropic' },
  // The theme wall, and under it only what a theme sets (2026-09-28).
  { id: 'term-theme', label: 'Terminal theme', type: 'theme', key: 'prism.term.theme', section: 'theme', icon: 'brush', sub: 'Colours of the terminal and the window.', keywords: 'colors palette scheme dark light preset custom' },
  { id: 'term-acrylic', label: 'Acrylic terminal background', type: 'switch', key: 'prism.term.acrylic', section: 'theme', icon: 'glass', sub: 'The desktop shows through the window.', keywords: 'acrylic transparent glass blur mica see through' },
  // No Opacity row (#114): the theme Background's alpha is the window's
  // see-through where the terminal owns the window acrylic.
  { id: 'agent-color', label: 'Agent working colour', type: 'colour', key: 'prism.term.agentColor', section: 'colours', icon: 'working', sub: 'Follows the accent.', keywords: 'color indicator busy' },
  { id: 'agent-done-color', label: 'Agent finished colour', type: 'colour', key: 'prism.term.agentDoneColor', section: 'colours', icon: 'done', sub: 'Follows the theme green.', keywords: 'color indicator complete' },
  { id: 'agent-question-color', label: 'Agent question colour', type: 'colour', key: 'prism.term.agentQuestionColor', section: 'colours', icon: 'ask', sub: 'Follows the theme.', keywords: 'color indicator waiting' }
]

/** The option ids a host should be showing. */
export function terminalOptionIds(host: { windowAcrylic: boolean }): string[] {
  return TERMINAL_OPTIONS.filter((o) => !o.onlyWhere || host.windowAcrylic).map((o) => o.id)
}
