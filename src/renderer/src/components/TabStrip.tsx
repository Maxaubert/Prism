import { useState, type DragEvent, type JSX, type MouseEvent } from 'react'
import { tabLabels, type Tab } from '../lib/tabs'
import { useAgentColor, useAgentDoneColor, useAgentIndicator } from '../lib/termLook'
import { contrastRatio } from '../lib/termAnsi'

/**
 * The open projects, as a row under the title bar.
 *
 * Present from the first tab, so the `+` is always somewhere to reach and the
 * chrome never shifts under you when a second folder opens. It goes only when
 * there is nothing open at all, where EmptyState is already offering the way in.
 */
/** Set while a TAB is the thing being dragged, so a file drop still means
 *  "open this" and a tab drop means "move it here". */
const TAB_MIME = 'application/prism-tab'

export function TabStrip({
  tabs,
  activeId,
  workingIds,
  doneIds,
  agentIds,
  onPick,
  onClose,
  onNew,
  onDropFile,
  onReorder,
  wash
}: {
  tabs: Tab[]
  activeId: string | null
  /** Sessions with SUSTAINED recent output: with an agent present, this IS
   *  the indicator. Idle looks default - only working paints. */
  workingIds: ReadonlySet<string>
  /** Sessions whose agent finished while their tab was in the background;
   *  they wear the finished colour until the tab is visited. */
  doneIds: ReadonlySet<string>
  /** Sessions whose shell currently hosts an AI CLI (Claude Code, codex). */
  agentIds: ReadonlySet<string>
  onPick: (id: string) => void
  onClose: (id: string) => void
  /** The + at the end. This one ADDS a tab, rooted at the user's own folder
   *  with nothing to answer first; the sidebar's folder button is the one that
   *  opens a chooser, and it replaces the current tab. Different verbs, so
   *  different labels. */
  onNew: () => void
  /** A file dropped on the strip opens in a new tab. */
  onDropFile: (path: string) => void
  /** A tab dragged along the strip lands in front of `toIndex` (#70). */
  onReorder: (id: string, toIndex: number) => void
  /** Whether the style's light reaches the strip. Follows the title bar, so
   *  the setup's mode wipe does not tear between the two rows. */
  wash: boolean
}): JSX.Element | null {
  const indicator = useAgentIndicator()
  const agentColor = useAgentColor()
  const doneColor = useAgentDoneColor()
  // Full mode fills the tab with the chosen colour. Text biases WHITE: strict
  // contrast maths picks black on the default orange, but white-on-orange is
  // the look; black only wins on genuinely light fills (contrast vs black of
  // 12 is a ~0.55 luminance threshold).
  const onTint = (c: string): string => (contrastRatio('#000000', c) < 12 ? '#ffffff' : '#000000')
  // Where a dragged tab would land: the slot index, drawn as a hairline.
  const [dropAt, setDropAt] = useState<number | null>(null)
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
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onDrop={(e) => {
        // Dropping a file here opens it in a NEW tab; stopPropagation keeps
        // the window-level drop from opening it in the current one.
        e.preventDefault()
        e.stopPropagation()
        const moved = e.dataTransfer.getData(TAB_MIME)
        setDropAt(null)
        if (moved) {
          onReorder(moved, dropAt ?? tabs.length)
          return
        }
        const f = e.dataTransfer.files?.[0]
        if (f) onDropFile(window.prism.getDroppedPath(f))
      }}
      onDragLeave={() => setDropAt(null)}
      className={`drag p-styled-font flex h-8 shrink-0 items-stretch gap-0 overflow-x-auto border-b border-[var(--p-divider)] bg-[var(--p-title)] pr-1 text-[12px] transition-[background-color,border-color] duration-[550ms] [transition-timing-function:cubic-bezier(.16,1,.3,1)] ${wash ? 'p-wash' : ''}`}
    >
      {tabs.map((t, i) => {
        const on = t.id === activeId
        // The agent indicator: paints while the agent is genuinely working
        // (the working colour) or finished behind another tab (the finished
        // colour, until visited) - the whole tab filled (full) or the brain
        // icon plus edge bar tinted (minimal). Idle shows nothing.
        const working =
          indicator !== 'off' && !!t.term && agentIds.has(t.term.id) && workingIds.has(t.term.id)
        const done = !working && indicator !== 'off' && !!t.term && doneIds.has(t.term.id)
        const tint = working ? agentColor : done ? doneColor : null
        const loud = tint !== null && indicator === 'full'
        return (
          <div
            key={t.id}
            data-agent={tint ? indicator : undefined}
            data-agent-present={t.term && agentIds.has(t.term.id) ? '' : undefined}
            // Hairline side edges in the divider token: they separate flush
            // tabs when the style draws edges, and vanish (the token goes
            // transparent) when it doesn't. Right edges only: the first tab
            // sits flush against the window's left side, no line before it.
            className={`no-drag group relative flex min-w-0 shrink items-center gap-1.5 border-r border-[color:var(--p-divider)] px-2.5 transition-colors ${
              loud
                ? ''
                : on
                  ? 'bg-[var(--p-side-flat)] text-[var(--p-text)]'
                  : 'text-[var(--p-dim)] hover:bg-white/5 hover:text-[var(--p-text)]'
            }`}
            style={loud && tint ? { background: tint, color: onTint(tint) } : undefined}
            // The WHOLE tab is the click target, not just the label: the
            // padding, the icon slot and the slack around a short name all
            // pick the tab. The close button stops propagation to opt out.
            onClick={() => onPick(t.id)}
            onAuxClick={(e) => auxClose(e, t.id)}
            // Tabs reorder by dragging (#70): the half of the tab the pointer
            // is over decides which side of it the dragged tab lands.
            draggable
            onDragStart={(e: DragEvent) => {
              e.dataTransfer.setData(TAB_MIME, t.id)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragEnd={() => setDropAt(null)}
            onDragOver={(e: DragEvent) => {
              if (!e.dataTransfer.types.includes(TAB_MIME)) return
              e.preventDefault()
              const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setDropAt(e.clientX < box.left + box.width / 2 ? i : i + 1)
            }}
          >
            {dropAt === i && (
              <span className="absolute inset-y-0 left-0 w-0.5 bg-[var(--p-accent-hi)]" aria-hidden />
            )}
            {dropAt === i + 1 && (
              <span className="absolute inset-y-0 right-0 w-0.5 bg-[var(--p-accent-hi)]" aria-hidden />
            )}
            {/* The active mark: an accent rule along the top. It yields while
                the working fill is up - two signals on one tab would fight. */}
            {on && !loud && <span className="absolute inset-x-0 top-0 h-0.5 bg-[var(--p-accent-hi)]" aria-hidden />}
            {/* Minimal mark: the tinted brain plus a bar down the LEFT edge,
                so a working or finished tab reads at a glance even narrow. */}
            {tint && indicator === 'minimal' && (
              <span className="absolute inset-y-0 left-0 w-0.5" style={{ background: tint }} aria-hidden />
            )}
            {/* A permanent icon slot: the brain appears in it while the
                agent works or waits unseen (tinted in minimal, on-colour in
                full) and it is transparent otherwise - so the tab NEVER
                changes width. */}
            <span className="grid h-[13px] w-[13px] shrink-0 place-items-center" aria-hidden={!tint}>
              {tint && (
                <svg
                  data-activity={working ? 'working' : 'done'}
                  viewBox="0 0 24 24"
                  width={13}
                  height={13}
                  fill="none"
                  stroke={indicator === 'full' ? 'currentColor' : tint}
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-label={working ? 'Agent working' : 'Agent finished'}
                >
                  <path d="M9.5 4a2.7 2.7 0 0 0-2.7 2.7c-1.5.3-2.6 1.6-2.6 3.2 0 .8.3 1.6.8 2.1a3.2 3.2 0 0 0 1.3 5.4A2.9 2.9 0 0 0 9.2 20c.5 0 1-.1 1.3-.4V4.5A2.6 2.6 0 0 0 9.5 4zM14.5 4a2.7 2.7 0 0 1 2.7 2.7c1.5.3 2.6 1.6 2.6 3.2 0 .8-.3 1.6-.8 2.1a3.2 3.2 0 0 1-1.3 5.4A2.9 2.9 0 0 1 14.8 20c-.5 0-1-.1-1.3-.4V4.5a2.6 2.6 0 0 1 1-.5z" />
                </svg>
              )}
            </span>
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
              onClick={(e) => {
                e.stopPropagation()
                onClose(t.id)
              }}
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
