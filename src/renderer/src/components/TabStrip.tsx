import { useEffect, useRef, useState, type JSX, type MouseEvent, type PointerEvent } from 'react'
import { tabLabels, type Tab } from '../lib/tabs'
import { useAgentColor, useAgentDoneColor, useAgentIndicator } from '../lib/termLook'
import { contrastRatio } from '../lib/termAnsi'
import { recentLabels, recentRoots } from '../lib/recentRoots'
import { dragPayload, setDrag } from '../lib/dragDrop'
import { ContextMenu } from './ContextMenu'

/**
 * The open projects, as a row under the title bar.
 *
 * Present from the first tab, so the `+` is always somewhere to reach and the
 * chrome never shifts under you when a second folder opens. It goes only when
 * there is nothing open at all, where EmptyState is already offering the way in.
 */
/** How far the pointer must travel before a press becomes a drag rather than
 *  a click on the tab. */
const DRAG_SLOP = 4

/** The tree's folder, at menu size: the + menu lists PLACES. */
const FolderGlyph = (): JSX.Element => (
  <svg viewBox="0 0 24 24" width={13} height={13} fill="var(--p-tree-folder)" className="shrink-0" aria-hidden>
    <path d="M2.5 5.5h6.2l2 2.6h10.8v10.4H2.5z" />
  </svg>
)

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
  onOpenRecent,
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
  /** Open a folder from the + menu's list of places Prism has been. */
  onOpenRecent: (path: string) => void
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
  // A tab being carried (#71 follow-up): the strip animates it rather than
  // drawing a hairline - the tab lifts out and its neighbours slide across to
  // open the gap it would drop into, which is what "picked up" looks like.
  // Reordering is a POINTER drag, not an HTML5 one (owner, 2026-08-23): a
  // system drag goes anywhere on screen and carries an OS snapshot; a tab
  // should slide left and right inside its own row and nowhere else. The
  // strip keeps its HTML5 handlers for FILES dropped onto it - that is a
  // different gesture with a different meaning.
  // While ANY drag is in flight the strip stops being a window-drag handle.
  // The empty space after the + is the natural place to drop a folder, but it
  // is app-region drag: Chromium hands presses there to the OS, so no
  // dragover ever arrived and the drop could only be made over a tab. The
  // handle comes back the moment the drag ends.
  const [dragInFlight, setDragInFlight] = useState(false)
  useEffect(() => {
    const on = (): void => setDragInFlight(true)
    const off = (): void => setDragInFlight(false)
    window.addEventListener('dragstart', on, true)
    window.addEventListener('dragenter', on, true)
    window.addEventListener('dragend', off, true)
    window.addEventListener('drop', off, true)
    return () => {
      window.removeEventListener('dragstart', on, true)
      window.removeEventListener('dragenter', on, true)
      window.removeEventListener('dragend', off, true)
      window.removeEventListener('drop', off, true)
    }
  }, [])
  const [plusMenu, setPlusMenu] = useState<{ x: number; y: number; recent: string[] } | null>(null)
  /** A tab's own menu. Deliberately WITHOUT 'close others': each close can
   *  raise the unsaved-changes question, and firing several would overwrite
   *  it and lose the work it exists to protect. That wants App-side
   *  batching, which is a decision rather than a gap to fill here. */
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; id: string; root: string } | null>(
    null
  )
  const [dropAt, setDropAt] = useState<number | null>(null)
  const [carry, setCarry] = useState<{
    id: string
    from: number
    width: number
    dx: number
    /** True once the press travelled past the slop: only THEN is it a drag. */
    live: boolean
  } | null>(null)
  // The tab boundaries as they were when the drag STARTED. Asking which tab
  // sits under the pointer cannot work once they animate: the neighbour
  // slides out from under the cursor, the answer flips back, and the strip
  // judders. Frozen geometry has no feedback loop.
  const lanes = useRef<Array<{ left: number; width: number; mid: number }>>([])
  const strip = useRef<HTMLDivElement>(null)
  const startX = useRef(0)
  /** True once the press has travelled far enough to BE a drag: a plain click
   *  must still switch tabs. */
  const dragging = useRef(false)
  /** Whatever had the keyboard before the drag: a shell, a tree row, the
   *  search box. Dragging a tab is not leaving it. */
  const heldFocus = useRef<HTMLElement | null>(null)
  const endDrag = (): void => {
    setDropAt(null)
    setCarry(null)
    lanes.current = []
    const el = heldFocus.current
    heldFocus.current = null
    if (el && document.contains(el)) requestAnimationFrame(() => el.focus())
  }
  /** The slot a point is asking for, from the frozen lanes. */
  const slotAt = (x: number): number => {
    const at = lanes.current.findIndex((l) => x < l.mid)
    return at === -1 ? lanes.current.length : at
  }
  const onTabPointerDown = (e: PointerEvent<HTMLDivElement>, id: string, i: number): void => {
    if (e.button !== 0) return
    // The X is not a handle: capturing the pointer here would swallow its
    // own click and close nothing.
    if ((e.target as HTMLElement).closest('[data-tab-close]')) return
    heldFocus.current = document.activeElement as HTMLElement | null
    const boxes = [...(strip.current?.querySelectorAll('[data-tab]') ?? [])].map((el) =>
      el.getBoundingClientRect()
    )
    lanes.current = boxes.map((b) => ({ left: b.left, width: b.width, mid: b.left + b.width / 2 }))
    startX.current = e.clientX
    dragging.current = false
    setCarry({ id, from: i, width: boxes[i]?.width ?? 0, dx: 0, live: false })
    setDropAt(i)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onTabPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (!carry) return
    const raw = e.clientX - startX.current
    if (!dragging.current && Math.abs(raw) < DRAG_SLOP) return
    dragging.current = true
    // Clamped to the row: the tab cannot be carried out of the strip, which
    // is the whole point of doing this with the pointer.
    const lane = lanes.current[carry.from]
    const box = strip.current?.getBoundingClientRect()
    const dx =
      lane && box
        ? Math.max(box.left - lane.left, Math.min(raw, box.right - (lane.left + lane.width)))
        : raw
    setCarry((c) => (c ? { ...c, dx, live: true } : c))
    // The CARRIED tab's own centre decides, not the pointer: it is what the
    // eye is following, and it keeps a grab near an edge honest.
    if (lane) setDropAt(slotAt(lane.mid + dx))
  }
  const onTabPointerUp = (e: PointerEvent<HTMLDivElement>): void => {
    if (!carry) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    const landed = dragging.current ? dropAt : null
    const id = carry.id
    endDrag()
    if (landed !== null) onReorder(id, landed)
  }
  /** How far a tab slides to open the gap: everything between the carried
   *  tab's old slot and the one under the pointer shifts by its width. */
  const slide = (i: number): number => {
    if (!carry || dropAt === null || i === carry.from) return 0
    if (dropAt > carry.from && i > carry.from && i < dropAt) return -carry.width
    if (dropAt <= carry.from && i >= dropAt && i < carry.from) return carry.width
    return 0
  }
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
      ref={strip}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onDrop={(e) => {
        // Dropping something here opens it in a NEW tab; stopPropagation keeps
        // the window-level drop from opening it in the current one. Tabs
        // themselves reorder by pointer, not by this.
        e.preventDefault()
        e.stopPropagation()
        // Prism's own rows carry their paths in the drag payload, not as
        // files - a folder dragged out of the tree has to land here too, and
        // that is the natural way to open one beside what you have.
        const inside = dragPayload(e.dataTransfer)
        setDrag(null)
        if (inside?.kind === 'files') {
          for (const p of inside.paths) onDropFile(p)
          return
        }
        for (const f of e.dataTransfer.files ?? []) onDropFile(window.prism.getDroppedPath(f))
      }}
      // While a tab is genuinely being carried the whole strip wears the
      // closed hand, children included: a tab is made of a label button, an
      // icon slot and an X, each with a cursor of its own, and letting them
      // answer for themselves made it flicker under the moving pointer.
      className={`${dragInFlight ? 'no-drag' : 'drag'} p-styled-font flex h-8 shrink-0 items-stretch gap-0 overflow-x-auto border-b border-[var(--p-divider)] bg-[var(--p-title)] pr-1 text-[12px] transition-[background-color,border-color] duration-[550ms] [transition-timing-function:cubic-bezier(.16,1,.3,1)] ${
        carry?.live ? 'cursor-grabbing [&_*]:cursor-grabbing' : ''
      } ${wash ? 'p-wash' : ''}`}
    >
      {tabs.map((t, i) => {
        const on = t.id === activeId
        // The agent indicator: paints while the agent is genuinely working
        // (the working colour) or finished behind another tab (the finished
        // colour, until visited) - the whole tab filled (full) or the brain
        // icon plus edge bar tinted (minimal). Idle shows nothing.
        const working =
          indicator !== 'off' && !!t.term && agentIds.has(t.term.id) && workingIds.has(t.term.id)
        // Finished-while-away belongs to FULL alone (owner, 2026-08-23):
        // minimal answers one question, "is something running right now", and
        // a tab that has merely stopped is not that.
        const done = indicator === 'full' && !working && !!t.term && doneIds.has(t.term.id)
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
                  ? // --p-side, not --p-side-flat: the flat token is the OPAQUE
                    // one, so under acrylic the active tab was a solid slab in a
                    // translucent strip, and the more glass you asked for the
                    // more it stood out (2026-08-27). This is the same surface
                    // the sidebar wears.
                    'bg-[var(--p-side)] text-[var(--p-text)]'
                  : 'text-[var(--p-dim)] hover:bg-white/5 hover:text-[var(--p-text)]'
            }`}
            style={{
              ...(loud && tint ? { background: tint, color: onTint(tint) } : {}),
              transform: `translateX(${carry?.id === t.id ? carry.dx : slide(i)}px)`,
              zIndex: carry?.id === t.id ? 5 : undefined,
              // What you carry is a COPY - Chromium's own drag snapshot - so
              // the tab you picked up stays exactly where it was, solid, and
              // the strip only really rearranges when the drop lands. The
              // neighbours sliding open the gap are the preview.
              transition:
                carry && carry.id !== t.id ? 'transform 170ms cubic-bezier(.23,1,.32,1)' : undefined
            }}
            // The WHOLE tab is the click target, not just the label: the
            // padding, the icon slot and the slack around a short name all
            // pick the tab. The close button stops propagation to opt out.
            onClick={() => {
              // A press that travelled is a drag, not a pick.
              if (dragging.current) {
                dragging.current = false
                return
              }
              onPick(t.id)
            }}
            onAuxClick={(e) => auxClose(e, t.id)}
            // The tab's own menu (2026-08-30). The wrapper owns it, not the
            // inner button: the padding and the icon slot are part of the
            // target, the same reasoning the click handler gives. A right
            // click cannot start a carry - onTabPointerDown ignores button 2.
            onContextMenu={(e) => {
              e.preventDefault()
              setTabMenu({ x: e.clientX, y: e.clientY, id: t.id, root: t.kind === 'settings' ? '' : t.root })
            }}
            // Tabs reorder by dragging (#70): the half of the tab the pointer
            // is over decides which side of it the dragged tab lands.
            data-tab
            onPointerDown={(e) => onTabPointerDown(e, t.id, i)}
            onPointerMove={onTabPointerMove}
            onPointerUp={onTabPointerUp}
            onPointerCancel={() => carry && endDrag()}
          >
            {/* The active mark: an accent rule along the top. It yields while
                the working fill is up - two signals on one tab would fight. */}
            {on && !loud && <span className="absolute inset-x-0 top-0 h-0.5 bg-[var(--p-accent-hi)]" aria-hidden />}
            {/* Minimal mark: a bar running along the BOTTOM edge while the
                agent works, the way a loading tab reads. It sits under the
                label rather than beside it, so a narrow tab loses none of its
                name to it. */}
            {working && indicator === 'minimal' && (
              <span className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] overflow-hidden" aria-hidden>
                <span
                  className="p-agent-run absolute inset-y-0 w-[42%] rounded-full"
                  style={{ background: agentColor }}
                />
              </span>
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
              onClick={() => {
              // A press that travelled is a drag, not a pick.
              if (dragging.current) {
                dragging.current = false
                return
              }
              onPick(t.id)
            }}
            >
              {labels[i]}
            </button>
            <button
              className={`grid h-4 w-4 shrink-0 place-items-center rounded-sm text-[var(--p-icon)] transition-opacity hover:bg-white/10 hover:text-[var(--p-text)] ${
                on ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
              data-tab-close
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
        title="New tab (Ctrl+T). Right-click for recent folders"
        aria-label="New tab"
        onClick={onNew}
        // The + adds a tab instantly; its RIGHT click is where "somewhere I
        // have been before" lives, so the instant verb stays instant.
        onContextMenu={(e) => {
          e.preventDefault()
          // Read when it opens: the list is history, and history moves.
          setPlusMenu({ x: e.clientX, y: e.clientY, recent: recentRoots().slice(0, 5) })
        }}
      >
        <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M12 6v12m6-6H6" />
        </svg>
      </button>
      {tabMenu && (
        <ContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          onClose={() => setTabMenu(null)}
          items={[
            // Every row acts on the tab you clicked. "New tab" was here and
            // went (2026-08-31): the + is one pixel away and its tooltip
            // already teaches Ctrl+T.
            { label: 'Close tab', hint: 'Ctrl+W', onPick: () => onClose(tabMenu.id) },
            // Settings is a tab with no folder. Offering these there did
            // nothing for one of them and wrote an EMPTY STRING over the
            // clipboard for the other, which is worse than doing nothing.
            ...(tabMenu.root
              ? [
                  {
                    label: 'Show folder in File Explorer',
                    onPick: () => window.prism.showInExplorer(tabMenu.root)
                  },
                  {
                    label: 'Copy folder path',
                    onPick: () => void navigator.clipboard.writeText(tabMenu.root)
                  }
                ]
              : [])
          ]}
        />
      )}
      {plusMenu && (
        <ContextMenu
          x={plusMenu.x}
          y={plusMenu.y}
          onClose={() => setPlusMenu(null)}
          items={
            plusMenu.recent.length
              ? recentLabels(plusMenu.recent).map((r) => ({
                  label: r.label,
                  // A folder in front of each, in the tree's own folder
                  // colour: the menu should say "places" at a glance, not
                  // read as a list of commands.
                  icon: <FolderGlyph />,
                  onPick: () => onOpenRecent(r.path)
                }))
              : [{ label: 'No recent folders', disabled: true }]
          }
        />
      )}
    </div>
  )
}
