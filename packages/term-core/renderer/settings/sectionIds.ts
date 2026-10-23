/**
 * THE CORE'S SETTINGS SECTIONS, by id, with the heading each wears (2026-10-05,
 * the grouped cards redesign). A section is drawn the same in both apps; which
 * PAGE holds it is each host's (Prism Terminal puts the theme on Appearance,
 * Prism on Terminal). Every option list names its section here, and a test
 * holds every name to this record.
 *
 * `dictation` has no heading: it is the first section of the Dictation page,
 * and the page's own title says what it is. Nor has `diagnostics` (#140), the
 * one section of its page.
 */
export const SETTINGS_SECTIONS = {
  shell: 'Shell',
  text: 'Text',
  theme: 'Theme',
  help: 'Command help',
  marks: 'Tab marks',
  claude: 'Claude Code',
  colours: 'Mark colours',
  dictation: '',
  listening: 'Listening',
  while: 'While dictating',
  models: 'Speech models',
  gpu: 'GPU acceleration',
  diagnostics: ''
} as const

export type SettingsSectionId = keyof typeof SETTINGS_SECTIONS
