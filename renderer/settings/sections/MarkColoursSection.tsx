import type { JSX } from 'react'
import {
  setAgentColor,
  setAgentDoneColor,
  setAgentQuestionColor,
  useAgentColorChoice,
  useAgentDoneColorChoice,
  useAgentQuestionColorChoice
} from '../../lib/termLook'
import { useAgentColors } from '../../lib/agentColors'
import { ColourField } from '../ColourPicker'
import { RESET_LINK, SaveButton } from '../fields'
import { SettingRow } from '../layout/SettingRow'
import { SettingsSection } from '../layout/SettingsSection'
import { useTermSetup } from '../theme/useTermSetup'
import { opt, saveSetupTitle, sectionTitle } from './opts'

const OWN = 'Your own colour.'

/**
 * THE COLOURS OF THE MARKS (2026-10-05). Each follows the theme until one is
 * picked, then a Reset word puts it back. The theme's Save changes saves them
 * with it, so this section carries the SAME button in its heading (owner,
 * Q3): both save the whole setup as Custom and light together.
 */
export function MarkColoursSection(): JSX.Element {
  const agentCol = useAgentColorChoice()
  const doneCol = useAgentDoneColorChoice()
  const questionCol = useAgentQuestionColorChoice()
  const inForce = useAgentColors()
  const { dirty, save } = useTermSetup()
  const working = opt('agent-color')
  const finished = opt('agent-done-color')
  const question = opt('agent-question-color')
  return (
    <SettingsSection
      id="colours"
      title={sectionTitle('colours')}
      action={<SaveButton dirty={dirty} onClick={save} title={saveSetupTitle()} />}
    >
      <SettingRow id="agent-color" icon={working.icon} label={working.label} sub={agentCol ? OWN : working.sub}>
        {agentCol && (
          <button data-follow-theme="working" onClick={() => setAgentColor('')} className={RESET_LINK}>
            Reset
          </button>
        )}
        <ColourField label={working.label} value={inForce.working} onChange={setAgentColor} onRevert={() => setAgentColor(agentCol)} />
      </SettingRow>
      <SettingRow id="agent-done-color" icon={finished.icon} label={finished.label} sub={doneCol ? OWN : finished.sub}>
        {doneCol && (
          <button data-follow-theme="finished" onClick={() => setAgentDoneColor('')} className={RESET_LINK}>
            Reset
          </button>
        )}
        <ColourField label={finished.label} value={inForce.finished} onChange={setAgentDoneColor} onRevert={() => setAgentDoneColor(doneCol)} />
      </SettingRow>
      <SettingRow id="agent-question-color" icon={question.icon} label={question.label} sub={questionCol ? OWN : question.sub}>
        {questionCol && (
          <button data-follow-theme="question" onClick={() => setAgentQuestionColor('')} className={RESET_LINK}>
            Reset
          </button>
        )}
        <ColourField label={question.label} value={inForce.question} onChange={setAgentQuestionColor} onRevert={() => setAgentQuestionColor(questionCol)} />
      </SettingRow>
    </SettingsSection>
  )
}
