import type { JSX, MouseEvent } from 'react'
import { tabLabels, type Tab } from '../lib/tabs'
import { useAgentIndicator } from '../lib/termLook'

/**
 * The open projects, as a row under the title bar.
 *
 * Present from the first tab, so the `+` is always somewhere to reach and the
 * chrome never shifts under you when a second folder opens. It goes only when
 * there is nothing open at all, where EmptyState is already offering the way in.
 */
export function TabStrip({
  tabs,
  activeId,
  workingIds,
  agentIds,
  onPick,
  onClose,
  onNew,
  wash
}: {
  tabs: Tab[]
  activeId: string | null
  /** Sessions with SUSTAINED recent output: with an agent present, this IS
   *  the indicator. Idle looks default - only working paints. */
  workingIds: ReadonlySet<string>
  /** Sessions whose shell currently hosts an AI CLI (Claude Code, codex). */
  agentIds: ReadonlySet<string>
  onPick: (id: string) => void
  onClose: (id: string) => void
  /** The + at the end. This one ADDS a tab, rooted at the user's own folder
   *  with nothing to answer first; the sidebar's folder button is the one that
   *  opens a chooser, and it replaces the current tab. Different verbs, so
   *  different labels. */
  onNew: () => void
  /** Whether the style's light reaches the strip. Follows the title bar, so
   *  the setup's mode wipe does not tear between the two rows. */
  wash: boolean
}): JSX.Element | null {
  const indicator = useAgentIndicator()
  if (!tabs.length) return null
  const labels = tabLabels(tabs)
  // Middle-click closes, the way every tab strip does. `auxclick` rather than
  // mousedown so a stray middle press while scrolling does not lose a tab.
  const auxClose = (e: MouseEvent, id: string): void => {
    if (e.button === 1) {
      e.preventDefault()
      onClose(id)
    }
  }
  return (
    <div
      role="tablist"
      aria-label="Open folders"
      className={`drag p-styled-font flex h-8 shrink-0 items-stretch gap-px overflow-x-auto border-b border-[var(--p-divider)] bg-[var(--p-title)] px-1 text-[12px] transition-[background-color,border-color] duration-[550ms] [transition-timing-function:cubic-bezier(.16,1,.3,1)] ${wash ? 'p-wash' : ''}`}
    >
      {tabs.map((t, i) => {
        const on = t.id === activeId
        // The agent indicator: paints ONLY while the agent is genuinely
        // working, and how loudly is the Settings choice - a bar on the left
        // edge, or the whole tab in orange with a brain.
        const working = !!t.term && agentIds.has(t.term.id) && workingIds.has(t.term.id)
        const loud = working && indicator === 'full'
        return (
          <div
            key={t.id}
            data-agent={working ? indicator : undefined}
            data-agent-present={t.term && agentIds.has(t.term.id) ? '' : undefined}
            className={`no-drag group relative flex min-w-0 shrink items-center gap-1.5 px-2.5 transition-colors ${
              // The orange fill keeps the tab's SQUARE shape: with rounding,
              // a filled tab mid-strip read as a floating bubble.
              loud ? 'rounded-none' : 'rounded-t'
            } ${
              loud
                ? 'bg-[#f97316] text-white'
                : on
                  ? 'bg-[var(--p-side-flat)] text-[var(--p-text)]'
                  : 'text-[var(--p-dim)] hover:bg-white/5 hover:text-[var(--p-text)]'
            }`}
            onAuxClick={(e) => auxClose(e, t.id)}
          >
            {working && indicator === 'minimal' && (
              <span className="absolute inset-y-0 left-0 w-[3px] bg-[#f97316]" aria-hidden />
            )}
            {/* The accent is a rule along the top rather than a fill: the strip
                sits under a bar that is already accent-coloured, and a second
                block of indigo fought it. */}
            {on && !loud && <span className="absolute inset-x-0 top-0 h-0.5 bg-[var(--p-accent-hi)]" aria-hidden />}
            {loud && (
              <svg
                data-activity="working"
                viewBox="0 0 24 24"
                width={13}
                height={13}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0"
                aria-label="Agent working"
              >
                <path d="M9.5 4a2.7 2.7 0 0 0-2.7 2.7c-1.5.3-2.6 1.6-2.6 3.2 0 .8.3 1.6.8 2.1a3.2 3.2 0 0 0 1.3 5.4A2.9 2.9 0 0 0 9.2 20c.5 0 1-.1 1.3-.4V4.5A2.6 2.6 0 0 0 9.5 4zM14.5 4a2.7 2.7 0 0 1 2.7 2.7c1.5.3 2.6 1.6 2.6 3.2 0 .8-.3 1.6-.8 2.1a3.2 3.2 0 0 1-1.3 5.4A2.9 2.9 0 0 1 14.8 20c-.5 0-1-.1-1.3-.4V4.5a2.6 2.6 0 0 1 1-.5z" />
              </svg>
            )}
            {working && indicator === 'minimal' && (
              <span data-activity="working" className="hidden" aria-hidden />
            )}
            <button
              role="tab"
              aria-selected={on}
              tabIndex={on ? 0 : -1}
              className="min-w-0 max-w-[14rem] truncate py-1 text-left"
              title={t.root}
              onClick={() => onPick(t.id)}
            >
              {labels[i]}
            </button>
            <button
              className={`grid h-4 w-4 shrink-0 place-items-center rounded-sm text-[var(--p-icon)] transition-opacity hover:bg-white/10 hover:text-[var(--p-text)] ${
                on ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
              title={`Close ${labels[i]} (Ctrl+W)`}
              aria-label={`Close ${labels[i]}`}
              onClick={() => onClose(t.id)}
            >
              <svg viewBox="0 0 24 24" width={10} height={10} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        )
      })}
      <button
        className="no-drag my-1 grid w-7 shrink-0 place-items-center rounded text-[var(--p-icon)] transition-colors hover:bg-white/10 hover:text-[var(--p-text)]"
        title="New tab (Ctrl+T)"
        aria-label="New tab"
        onClick={onNew}
      >
        <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M12 6v12m6-6H6" />
        </svg>
      </button>
    </div>
  )
}
