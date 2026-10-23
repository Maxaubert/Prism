import type { JSX } from 'react'
import { setHelpEnabled, useHelpEnabled } from '../../lib/helpPrefs'
import { Switch } from '../fields'
import { SettingRow } from '../layout/SettingRow'
import { SettingsSection } from '../layout/SettingsSection'
import { opt, sectionTitle } from './opts'

/** THE COMMAND HELP SWITCH (#12), as a section. On by default; off means
 *  off: the host hides its button and gives the key back to the shell. */
export function HelpSection(): JSX.Element {
  const on = useHelpEnabled()
  const o = opt('help-enabled')
  return (
    <SettingsSection id="help" title={sectionTitle('help')}>
      <SettingRow id="help-enabled" icon={o.icon} label={o.label} sub={o.sub} tap>
        <Switch on={on} onChange={setHelpEnabled} label={o.label} />
      </SettingRow>
    </SettingsSection>
  )
}
