import { followsHostStyle } from '../../host'
import { DIAGNOSTICS_OPTIONS, type DiagnosticsOption } from '../diagnosticsOptions'
import { DICTATION_OPTIONS, type DictationOption } from '../dictationOptions'
import { TERMINAL_OPTIONS, type TerminalOption } from '../options'
import { SETTINGS_SECTIONS, type SettingsSectionId } from '../sectionIds'

// The lists, by id, for the sections that draw them: a row's label, icon and
// resting subtext are read from its list entry, so the page and Find a setting
// can never word a row two ways.

type AnyOption = TerminalOption | DictationOption | DiagnosticsOption

const byId = new Map<string, AnyOption>(
  [...TERMINAL_OPTIONS, ...DICTATION_OPTIONS, ...DIAGNOSTICS_OPTIONS].map((o) => [o.id, o])
)

/** A core option by id. Throws on a typo, which the unit suite then finds. */
export function opt(id: string): AnyOption {
  const o = byId.get(id)
  if (!o) throw new Error(`no settings option ${id}`)
  return o
}

/** The heading a core section wears. */
export const sectionTitle = (id: SettingsSectionId): string => SETTINGS_SECTIONS[id]

/** The theme row's subtext: where the host has styles of its own the window
 *  wears THOSE, and only a host with none (Prism Terminal) dresses its window
 *  in the terminal theme. */
export const themeSub = (): string =>
  followsHostStyle() ? 'Colours of the terminal text and ground.' : opt('term-theme').sub

/** What Save changes says it does, in every place it is drawn. */
export const saveSetupTitle = (): string => 'Saves the theme, agent colours and acrylic as Custom'

/** The acrylic row's subtext: the app style's glass, let through the terminal. */
export const acrylicSub = (): string => 'The desktop shows through the terminal.'
