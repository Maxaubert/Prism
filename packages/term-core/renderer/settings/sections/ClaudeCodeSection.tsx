import type { JSX } from 'react'
import { setAgentHooksOn, useAgentHooksOn } from '../../lib/termLook'
import { Switch } from '../fields'
import { SettingRow } from '../layout/SettingRow'
import { SettingsSection } from '../layout/SettingsSection'
import { opt, sectionTitle } from './opts'

/** Claude Code tells the tab when it works, waits, finishes or fails (#131);
 *  off, a new shell is not handed the plugin that tells it. */
export function ClaudeCodeSection(): JSX.Element {
  const hooksOn = useAgentHooksOn()
  const o = opt('agent-hooks')
  return (
    <SettingsSection id="claude" title={sectionTitle('claude')}>
      <SettingRow id="agent-hooks" icon={o.icon} label={o.label} sub={o.sub} tap>
        <Switch on={hooksOn} onChange={setAgentHooksOn} label={o.label} />
      </SettingRow>
    </SettingsSection>
  )
}
