import type { SettingsSectionId } from './sectionIds'

/**
 * EVERY DIAGNOSTICS ROW, BY ID (#140): the same deal `options.ts`,
 * `dictationOptions.ts` and `helpOptions.ts` make. Each renders as
 * `data-pref="<id>"`. A list of its own, so a host that has not wired the
 * log (Prism, until it does) reads none of it.
 *
 * No row has a localStorage key: Detailed logging is kept by MAIN, in
 * `<userData>\diag.json`, because main is what writes the log and must know
 * the answer before any page has loaded.
 */
export interface DiagnosticsOption {
  id: string
  label: string
  type: 'switch' | 'action'
  key: null
  section: SettingsSectionId
  icon: string
  sub: string
  keywords?: string
}

export const DIAGNOSTICS_OPTIONS: readonly DiagnosticsOption[] = [
  { id: 'diag-verbose', label: 'Detailed logging', type: 'switch', key: null, section: 'diagnostics', icon: 'log', sub: 'Records every call, for tracking down a problem.', keywords: 'verbose debug log trace' },
  { id: 'diag-folder', label: 'Log files', type: 'action', key: null, section: 'diagnostics', icon: 'folder', sub: 'Kept on this PC, never sent.', keywords: 'folder open logs diagnostics jsonl' },
  { id: 'diag-mark', label: 'Mark a problem', type: 'action', key: null, section: 'diagnostics', icon: 'flag', sub: 'Stamps this moment in the log.', keywords: 'stall freeze hang slow report' }
]
