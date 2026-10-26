/**
 * THE CORE'S SETTINGS SECTIONS, by id, with the heading each wears (2026-10-05,
 * the grouped cards redesign). Every option list names its section here, and a
 * test holds every name to this record. Only the Diagnostics page (#140) is
 * left in the core since the terminal and dictation went (2026-10-26); it has
 * no heading, being the one section of its page.
 */
export const SETTINGS_SECTIONS = {
  diagnostics: ''
} as const

export type SettingsSectionId = keyof typeof SETTINGS_SECTIONS
