import { coreSettingsIndex } from 'prism-term-core/renderer/settings/coreIndex'
import type { SettingsIndexEntry, SettingsPageDef } from 'prism-term-core/renderer/settings/layout/SettingsFrame'
import type { SettingsSectionId } from 'prism-term-core/renderer/settings/sectionIds'
import { APP_OPTIONS, APP_SECTIONS, type AppPageId } from './appOptions'
import { iconPath } from '../icons/settingsIcons'

// Prism's pages, where the core's sections sit on them, and the index Find a
// setting reads (2026-10-05, the grouped cards redesign, #292).

/** The pages, in the rail's order (spec 1.4.2); About sits at the bottom. */
export const SETTINGS_PAGES: Array<SettingsPageDef & { id: AppPageId }> = [
  { id: 'appearance', label: 'Appearance', icon: 'appearance' },
  { id: 'explorer', label: 'Explorer', icon: iconPath('explorer') },
  // Owner, 2026-10-06: "project specific settings should be in a tab called
  // project settings not in explorer".
  { id: 'project', label: 'Project settings', icon: iconPath('project') },
  { id: 'media', label: 'Media', icon: iconPath('media') },
  // The diagnostics log (#322): in the rail's bottom group, beside About,
  // with the other pages about the app itself rather than what it shows.
  { id: 'diagnostics', label: 'Diagnostics', icon: 'diagnostics', end: true },
  { id: 'about', label: 'About', icon: 'about', end: true }
]

/** Which page holds each of the core's sections HERE. */
const PAGE_OF: Record<SettingsSectionId, AppPageId> = {
  diagnostics: 'diagnostics'
}

/** Every row in the order the pages draw them, which is the order Find a
 *  setting lists matches in. A test holds this to the lists. */
export const ROW_ORDER = [
  'style-theme', 'see-through', 'theme-edits', 'c-bg', 'c-chrome', 'c-accent', 'c-selection', 'c-text', 'c-folder-icon',
  'c-font', 'tree-size', 'title-bar', 'tab-width', 'c-edges', 'c-corners',
  'explorer-side', 'explorer-size', 'drive-style', 'newtab-mode', 'open-external',
  'remember-tabs', 'remember-folders', 'win-e-shortcut', 'open-folders', 'explorer-verb', 'default-apps',
  'tree-side', 'newtab-show',
  'viz-style', 'viz-colour', 'viz-glow', 'viz-cycle', 'viz-move',
  'transport-style', 'transport-bg', 'transport-colour', 'transport-glow', 'transport-cycle', 'transport-move',
  'diag-verbose', 'diag-folder', 'diag-mark',
  'app-version', 'show-setup'
] as const

/** The index Find a setting reads: the core's rows drawn here (the
 *  Diagnostics page since #322), and this app's own, in page order. */
export function settingsIndex(): SettingsIndexEntry[] {
  const core = coreSettingsIndex({ pageOf: (s) => PAGE_OF[s] })
  const own: SettingsIndexEntry[] = APP_OPTIONS.map((o) => ({
    id: o.id,
    page: o.page,
    view: o.view,
    section: APP_SECTIONS[o.section],
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
