import { DIAGNOSTICS_OPTIONS } from './diagnosticsOptions'
import type { SettingsIndexEntry } from './layout/search'
import { SETTINGS_SECTIONS, type SettingsSectionId } from './sectionIds'

/**
 * THE CORE'S ROWS FOR FIND A SETTING (2026-10-05): one entry per row the host
 * DRAWS, read from the same lists the sections read, so the index cannot word a
 * row differently from the page. Which page holds a section is the host's
 * (`pageOf`).
 */
export function coreSettingsIndex({
  pageOf
}: {
  pageOf: (section: SettingsSectionId) => string
}): SettingsIndexEntry[] {
  return DIAGNOSTICS_OPTIONS.map((o) => ({
    id: o.id,
    page: pageOf(o.section),
    section: SETTINGS_SECTIONS[o.section] || '',
    sectionId: o.section,
    label: o.label,
    sub: o.sub,
    icon: o.icon,
    keywords: o.keywords
  }))
}
