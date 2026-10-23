import type { JSX, ReactNode } from 'react'
import { hostIndicators, hostRainbow, termHost } from '../../host'
import {
  setAgentDoneOn,
  setAgentFailedOn,
  setAgentIndicator,
  setAgentQuestionOn,
  setAgentRainbow,
  useAgentDoneOn,
  useAgentFailedOn,
  useAgentIndicator,
  useAgentQuestionOn,
  useAgentRainbow,
  type AgentIndicator
} from '../../lib/termLook'
import { Segmented, Switch } from '../fields'
import { SettingRow } from '../layout/SettingRow'
import { SettingsSection } from '../layout/SettingsSection'
import { opt, sectionTitle } from './opts'

/** Each choice's subtext where the host draws the core's marks (#143). */
const INDICATOR_SUB: Record<AgentIndicator, string> = {
  off: 'No mark while an agent works.',
  minimal: 'A line under the tab while it works.',
  ring: 'One small mark at the end of the tab, in its ink.',
  full: 'Tabs you are not on fill with colour.'
}
/** Full's subtext in a host that draws its OWN filled tab (Prism, no
 *  `tabMarks`): what it has always said there. */
const LEGACY_FULL_SUB = 'The whole tab fills while it works.'

// "Bar" since 2026-10-12 (owner: "agent indicator is only ring or bar"); the
// stored value stays `minimal`, so nobody's choice moves.
const INDICATOR_NAME: Record<AgentIndicator, string> = { off: 'Off', minimal: 'Bar', ring: 'Ring', full: 'Full' }

/**
 * HOW A TAB MARKS ITS AGENT (2026-10-05, the grouped cards redesign): off, a
 * line under the tab, a spinner by the name (Ring, #143, where the host draws
 * it), or the tabs you are not on filled; the rainbow finish where the host
 * draws it (#143); and the three marks a tab keeps while you are not looking
 * (2026-09-28; #131 for Failed). The indicator's style belongs to no theme: a
 * theme pick never resets it. `after`: the host's own rows about the same
 * marks (Prism Terminal: the taskbar count).
 */
export function AgentMarksSection({ after }: { after?: ReactNode } = {}): JSX.Element {
  const volume = useAgentIndicator()
  const doneOn = useAgentDoneOn()
  const questionOn = useAgentQuestionOn()
  const failedOn = useAgentFailedOn()
  const rainbowOn = useAgentRainbow()
  // What the host's strip draws, read at render: the host speaks first.
  const choices = hostIndicators()
  const ownMarks = !!termHost().tabMarks
  const ind = opt('agent-indicator')
  const done = opt('agent-done-on')
  const rainbow = opt('agent-rainbow')
  const question = opt('agent-question-on')
  const failed = opt('agent-failed-on')
  return (
    <SettingsSection id="marks" title={sectionTitle('marks')}>
      <SettingRow
        id="agent-indicator"
        icon={ind.icon}
        label={ind.label}
        sub={volume === 'full' && !ownMarks ? LEGACY_FULL_SUB : INDICATOR_SUB[volume]}
      >
        <Segmented
          value={volume}
          onChange={(v) => setAgentIndicator(v as AgentIndicator)}
          options={choices.map((id) => ({ id, name: INDICATOR_NAME[id] }))}
        />
      </SettingRow>
      <SettingRow id="agent-done-on" icon={done.icon} label={done.label} sub={done.sub} tap>
        <Switch on={doneOn} onChange={setAgentDoneOn} label={done.label} />
      </SettingRow>
      {/* THE RAINBOW FINISH (#143), only where the host's strip draws it. */}
      {hostRainbow() && (
        <SettingRow id="agent-rainbow" icon={rainbow.icon} label={rainbow.label} sub={rainbow.sub} tap>
          <Switch on={rainbowOn} onChange={setAgentRainbow} label={rainbow.label} />
        </SettingRow>
      )}
      <SettingRow id="agent-question-on" icon={question.icon} label={question.label} sub={question.sub} tap>
        <Switch on={questionOn} onChange={setAgentQuestionOn} label={question.label} />
      </SettingRow>
      <SettingRow id="agent-failed-on" icon={failed.icon} label={failed.label} sub={failed.sub} tap>
        <Switch on={failedOn} onChange={setAgentFailedOn} label={failed.label} />
      </SettingRow>
      {after}
    </SettingsSection>
  )
}
