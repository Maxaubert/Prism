import type { JSX } from 'react'
import { AGENT_NAMES, closeQuestionTitle } from 'prism-term-core/renderer/lib/agentClose'
import { humanFor } from 'prism-term-core/renderer/lib/agentClock'
import { Dialog } from '../components/Dialog'
import { DIALOG_EMPHASIS } from '../components/dialogLook'
import type { AgentBusy } from './asks'

/**
 * Closing a tab, the window or installing an update while an agent is in a
 * shell. An install is the window question by another door (#168), and it
 * says what it is about to do: "close the window?" over a button the user
 * pressed to INSTALL is a question about something they did not ask for.
 * The wording is the core's, as the rest is.
 */
export function CloseAgentDialog({
  target,
  label,
  agent,
  others = 0,
  onCancel,
  onClose
}: {
  target: 'tab' | 'window' | 'install'
  /** The tab the agent is in. */
  label: string
  agent: AgentBusy
  /** How many more shells are working too (the window only). */
  others?: number
  onCancel: () => void
  onClose: () => void
}): JSX.Element {
  const whole = target !== 'tab'
  return (
    <Dialog
      title={closeQuestionTitle(target, agent.forMs)}
      body={
        // Naming the work is the whole point of asking (2026-08-31): an
        // idle prompt and an agent eleven minutes into an answer are not
        // the same close. The wording is Prism Terminal's, on purpose.
        agent.forMs === null ? (
          <>
            <span className={DIALOG_EMPHASIS}>{AGENT_NAMES[agent.kind]}</span> is running in{' '}
            <span className={DIALOG_EMPHASIS}>{label}</span>. Closing the tab kills the shell, and
            the session with it.
          </>
        ) : (
          <>
            <span className={DIALOG_EMPHASIS}>{AGENT_NAMES[agent.kind]}</span> has been working for{' '}
            {humanFor(agent.forMs)} in <span className={DIALOG_EMPHASIS}>{label}</span>
            {whole &&
              others > 0 &&
              `, and ${others} other ${others === 1 ? 'shell is' : 'shells are'} working too`}
            .{' '}
            {target === 'install'
              ? 'Installing restarts Prism, which kills the shell, and the answer with it.'
              : 'Closing kills the shell, and the answer with it.'}
          </>
        )
      }
      onCancel={onCancel}
      choices={[
        { label: 'Cancel', onPick: onCancel },
        {
          label:
            target === 'install'
              ? 'Install and restart'
              : target === 'window'
                ? 'Close window'
                : 'Close tab',
          primary: true,
          onPick: onClose
        }
      ]}
    />
  )
}
