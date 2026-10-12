import type { JSX } from 'react'
import { setAgentColour, useAgentColourChoice, type AgentColourState } from '../../lib/termLook'
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
  const { dirty, save } = useTermSetup()
  return (
    <SettingsSection
      id="colours"
      title={sectionTitle('colours')}
      action={<SaveButton dirty={dirty} onClick={save} title={saveSetupTitle()} />}
    >
      <AgentColourRow id="agent-color" state="working" />
      <AgentColourRow id="agent-done-color" state="finished" />
      <AgentColourRow id="agent-question-color" state="question" />
    </SettingsSection>
  )
}

/** One mark's colour: the colour in force, and Reset while one is picked. */
function AgentColourRow({ id, state }: { id: string; state: AgentColourState }): JSX.Element {
  const chosen = useAgentColourChoice(state)
  const inForce = useAgentColors()[state]
  const o = opt(id)
  const set = (hex: string): void => setAgentColour(state, hex)
  return (
    <SettingRow id={id} icon={o.icon} label={o.label} sub={chosen ? OWN : o.sub}>
      {chosen && (
        <button data-follow-theme={state} onClick={() => set('')} className={RESET_LINK}>
          Reset
        </button>
      )}
      <ColourField label={o.label} value={inForce} onChange={set} onRevert={() => set(chosen)} />
    </SettingRow>
  )
}
