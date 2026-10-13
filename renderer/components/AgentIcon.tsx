import type { JSX } from 'react'
import { CLAWD_ORANGE, CLAWD_PIXELS, COG_PATH, OPENAI_PATH, type IconKind } from '../lib/agentIcon'

/**
 * THE AGENT'S OWN MARK ON ITS TAB (owner, 2026-10-12, from the tab looks
 * mockups: "use the actual icons for claude and chatgpt"; spec
 * `docs/superpowers/specs/2026-10-12-tab-icons-design.md`). Every tab shows
 * what runs in it, so a tab is found by its shape before its name is read.
 *
 * - Claude Code: CLAWD, its own mascot, in its orange (the owner's pick over
 *   the Claude spark and the Anthropic A).
 * - Codex: the OpenAI mark, in the name's ink (monochrome).
 * - No agent, or another: a `>_` prompt, in the name's ink.
 * - Settings: the title bar's own cog (COG_PATH).
 *
 * Core, so Prism's tabs can wear it too; nothing there changes until they do.
 */
export function AgentIcon({ kind, size }: { kind: IconKind; size: number }): JSX.Element {
  const common = { width: size, height: size, 'aria-hidden': true as const, 'data-agent-icon': kind }
  switch (kind) {
    case 'claude':
      return (
        <svg {...common} viewBox="0.5 -2.5 17 17" fill={CLAWD_ORANGE} shapeRendering="crispEdges">
          {CLAWD_PIXELS.map(([x, y]) => (
            <rect key={`${x}.${y}`} x={x} y={y * 2} width={1.02} height={2.04} />
          ))}
        </svg>
      )
    case 'codex':
      return (
        <svg {...common} viewBox="0 0 24 24" fill="currentColor">
          <path d={OPENAI_PATH} />
        </svg>
      )
    case 'settings':
      return (
        // The title bar's own cog (owner, 2026-10-13: "the title bar cog").
        <svg {...common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d={COG_PATH} />
        </svg>
      )
    default:
      return (
        <svg {...common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 7l5 5-5 5M12 17h7" />
        </svg>
      )
  }
}
