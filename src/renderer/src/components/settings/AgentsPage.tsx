import type { JSX } from 'react'
import { AgentMarksSection } from 'prism-term-core/renderer/settings/sections/AgentMarksSection'
import { ClaudeCodeSection } from 'prism-term-core/renderer/settings/sections/ClaudeCodeSection'
import { MarkColoursSection } from 'prism-term-core/renderer/settings/sections/MarkColoursSection'

/** AGENTS: how a tab marks its agent, Claude Code's own word, and the marks'
 *  colours, all the core's (2026-10-05). Prism adds no row of its own: it has
 *  no taskbar count. `data-agent-settings` is what the gate reads. */
export function AgentsPage(): JSX.Element {
  return (
    <div data-agent-settings>
      <AgentMarksSection />
      <ClaudeCodeSection />
      <MarkColoursSection />
    </div>
  )
}
