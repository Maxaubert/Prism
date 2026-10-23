import { DIAGNOSTICS_OPTIONS } from './diagnosticsOptions'
import { dictationOptionIds } from './dictationOptions'
import { HELP_OPTIONS } from './helpOptions'
import { MARK_OPTIONS } from './markOptions'
import { terminalOptionIds } from './options'
import type { SettingsIndexEntry } from './layout/search'
import { SETTINGS_SECTIONS, type SettingsSectionId } from './sectionIds'
import { acrylicLabel, acrylicSub, opt, themeSub } from './sections/opts'

/**
 * THE CORE'S ROWS FOR FIND A SETTING (2026-10-05): one entry per terminal,
 * dictation and command help row the host DRAWS on this PC, read from the
 * same lists the sections read, so the index cannot word a row differently
 * from the page. Which page holds a section is the host's (`pageOf`); a row
 * that is not drawn here (the GPU row without an NVIDIA card, command help in
 * a host that has not wired it) is not in the index.
 */
export function coreSettingsIndex({
  pageOf,
  nvidia,
  help = true,
  diagnostics = false,
  marks = false
}: {
  pageOf: (section: SettingsSectionId) => string
  nvidia: boolean
  help?: boolean
  /** The Diagnostics page (#140): only in a host that wired the log. */
  diagnostics?: boolean
  /** The tab marks' own rows (#143): only in a host whose strip draws them,
   *  where the Agents page draws them, after the Finished switch. */
  marks?: boolean
}): SettingsIndexEntry[] {
  const ids = [
    ...terminalOptionIds({ windowAcrylic: false }).flatMap((id) =>
      id === 'agent-done-on' && marks ? [id, ...MARK_OPTIONS.map((o) => o.id)] : [id]
    ),
    ...dictationOptionIds({ nvidia }),
    ...(help ? HELP_OPTIONS.map((o) => o.id) : []),
    ...(diagnostics ? DIAGNOSTICS_OPTIONS.map((o) => o.id) : [])
  ]
  return ids.map((id) => {
    const o = opt(id)
    const section = o.section
    const sub = id === 'term-theme' ? themeSub() : id === 'term-acrylic' ? acrylicSub() : o.sub
    return {
      id,
      page: pageOf(section),
      section: SETTINGS_SECTIONS[section] || '',
      sectionId: section,
      // The see-through row is named per host (#156), as the page names it.
      label: id === 'term-acrylic' ? acrylicLabel() : o.label,
      sub,
      icon: o.icon,
      keywords: o.keywords
    }
  })
}
