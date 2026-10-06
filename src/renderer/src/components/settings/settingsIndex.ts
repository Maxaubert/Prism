import { coreSettingsIndex } from 'prism-term-core/renderer/settings/coreIndex'
import type { SettingsIndexEntry, SettingsPageDef } from 'prism-term-core/renderer/settings/layout/SettingsFrame'
import type { SettingsSectionId } from 'prism-term-core/renderer/settings/sectionIds'
import { APP_OPTIONS, APP_SECTIONS, type AppPageId } from './appOptions'
import { iconPath } from './icons'

// Prism's pages, where the core's sections sit on them, and the index Find a
// setting reads (2026-10-05, the grouped cards redesign, #292).

/** The pages, in the rail's order (spec 1.4.2); About sits at the bottom. */
export const SETTINGS_PAGES: Array<SettingsPageDef & { id: AppPageId }> = [
  { id: 'appearance', label: 'Appearance', icon: 'appearance' },
  { id: 'explorer', label: 'Explorer', icon: iconPath('explorer') },
  { id: 'terminal', label: 'Terminal', icon: 'terminal' },
  { id: 'agents', label: 'Agents', icon: 'agents' },
  { id: 'dictation', label: 'Dictation', icon: 'dictation' },
  { id: 'media', label: 'Media', icon: iconPath('media') },
  { id: 'about', label: 'About', icon: 'about', end: true }
]

/** Which page holds each of the core's sections HERE. Prism's window wears
 *  its own style, so the terminal theme is the Terminal page's (Q2); command
 *  help is Prism Terminal's alone (owner, 2026-09-22) and is never drawn. */
const PAGE_OF: Record<SettingsSectionId, AppPageId> = {
  shell: 'terminal',
  text: 'terminal',
  theme: 'terminal',
  help: 'terminal',
  marks: 'agents',
  claude: 'agents',
  colours: 'agents',
  dictation: 'dictation',
  listening: 'dictation',
  while: 'dictation',
  models: 'dictation',
  gpu: 'dictation'
}

/** Every row in the order the pages draw them, which is the order Find a
 *  setting lists matches in. A test holds this to the lists. */
export const ROW_ORDER = [
  'mode', 'style-theme', 'c-bg', 'c-chrome', 'c-accent', 'c-selection', 'c-text', 'c-folder-icon',
  'c-font', 'tree-size', 'title-bar', 'tab-width', 'c-edges', 'c-corners',
  'tree-side', 'explorer-size', 'drive-style', 'auto-scroll', 'newtab-mode', 'newtab-show', 'open-external',
  'remember-tabs', 'remember-folders', 'win-e-shortcut', 'explorer-verb', 'default-apps',
  'term-shell', 'term-font-family', 'term-font', 'term-theme', 'term-acrylic',
  'agent-indicator', 'agent-done-on', 'agent-question-on', 'agent-failed-on', 'agent-hooks',
  'agent-color', 'agent-done-color', 'agent-question-color',
  'dictation-enabled', 'dictation-mode', 'dictation-hotkey', 'dictation-mic', 'dictation-language',
  'dictation-pause-media', 'dictation-sounds', 'dictation-model', 'dictation-gpu',
  'viz-style', 'viz-colour', 'viz-glow', 'viz-cycle', 'viz-move',
  'transport-style', 'transport-bg', 'transport-colour', 'transport-glow', 'transport-cycle', 'transport-move',
  'app-version', 'show-setup'
] as const

/** The heading of the style's colours, as the page draws it. */
export const coloursTitle = (styleName: string): string => `Colours of ${styleName}`

/** The index Find a setting reads: the core's rows drawn here (no command
 *  help), and this app's own, in page order. `styleName` words the colours'
 *  section as the page heads it. */
export function settingsIndex(nvidia: boolean, styleName: string): SettingsIndexEntry[] {
  const core = coreSettingsIndex({ pageOf: (s) => PAGE_OF[s], nvidia, help: false })
  const own: SettingsIndexEntry[] = APP_OPTIONS.map((o) => ({
    id: o.id,
    page: o.page,
    view: o.view,
    section: o.section === 'style-colours' ? coloursTitle(styleName) : APP_SECTIONS[o.section],
    sectionId: o.section,
    label: o.label,
    sub: o.sub,
    icon: iconPath(o.icon),
    keywords: o.keywords
  }))
  const all = new Map([...core, ...own].map((e) => [e.id, e]))
  return ROW_ORDER.flatMap((id) => {
    const e = all.get(id)
    return e ? [e] : []
  })
}
