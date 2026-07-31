import { useEffect, useState, type JSX, type ReactNode } from 'react'
import { TRANSPORT_STYLES, TRANSPORT_GROUPS, type TransportStyle } from '../lib/transport'
import { DEFAULT_THEME_ID } from '../lib/viz/styles'
import type { VizTheme } from '../lib/viz/core'
import {
  useViz,
  visibleThemes,
  applyPreset,
  setTheme,
  setGlow,
  setCycle,
  setMove,
  setBarTheme,
  setBarGlow,
  setBarCycle,
  setBarMove,
  type Preset,
  type VizState
} from '../lib/vizStore'
import { VizPreview } from './VizPreview'
import { NAV_SCOPES, setNavScope, useNavScope, type NavScope } from '../lib/navScope'

// The app-wide Settings window: a large pop-up with a left tab rail and a content
// pane, so it reads like a real settings page. It and the in-canvas gear panel are
// two views over the same vizStore — a change in one shows in the other live.

/** A small schematic of each transport style, so the picker previews the shape
 *  without spinning up a real player. */
function Mini({ id }: { id: TransportStyle }): JSX.Element {
  const acc = 'var(--color-accent-hi)'
  const box = 'relative h-11 w-full overflow-hidden rounded-md bg-[#0e1016]'
  const dot = <span className="h-2 w-2 rounded-full bg-white/70" />
  const bars = (n: number, h: number, gap: string, bold = false): JSX.Element => (
    <div className={`flex w-full items-center ${gap}`}>
      {Array.from({ length: n }).map((_, i) => (
        <span
          key={i}
          className="flex-1 rounded-[1px]"
          style={{
            height: `${(bold ? h : h * 0.85) * (0.35 + 0.65 * Math.abs(Math.sin(i * 0.7) * Math.cos(i * 0.19)))}px`,
            background: i / n < 0.42 ? acc : 'rgba(255,255,255,.22)'
          }}
        />
      ))}
    </div>
  )
  const line = (h: number, glow = false): JSX.Element => (
    <div className="relative w-full rounded-full bg-white/20" style={{ height: h }}>
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: '42%', background: acc, boxShadow: glow ? `0 0 6px ${acc}` : undefined }} />
    </div>
  )

  switch (id) {
    case 'edge':
      return (
        <div className={box}>
          <div className="absolute inset-x-2 bottom-2 flex items-center gap-1.5 text-white/70">{dot}<span className="text-[9px]">controls</span></div>
          <div className="absolute inset-x-0 bottom-0">{line(2, true)}</div>
        </div>
      )
    case 'pill':
      return <div className={`${box} flex flex-col justify-center gap-2 px-2`}>{line(7)}<div className="flex gap-1.5">{dot}{dot}</div></div>
    case 'inline':
      return <div className={`${box} flex items-center gap-1.5 px-2`}>{dot}<div className="flex-1">{line(3)}</div>{dot}</div>
    case 'island':
      return (
        <div className={`${box} grid place-items-center`}>
          <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[.06] px-2 py-1">{dot}<div className="w-14">{line(3)}</div></div>
        </div>
      )
    case 'wave':
      return <div className={`${box} flex flex-col justify-center gap-1.5 px-2`}><div className="h-4">{bars(52, 16, 'gap-[1.5px]')}</div><div className="flex gap-1.5">{dot}{dot}</div></div>
    case 'outline':
      return (
        <div className={box}>
          <div className="absolute inset-x-2 top-2">{line(2, true)}</div>
          <div className="absolute inset-x-2 bottom-2 flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full border border-white/70" /><span className="h-2.5 w-2.5 rounded-full border border-white/70" />
          </div>
        </div>
      )
    case 'bold':
      return (
        <div className={box}>
          <div className="absolute inset-x-0 top-0">{line(4)}</div>
          <div className="absolute inset-x-2 bottom-1.5 flex items-center gap-2"><span className="h-4 w-4 rounded bg-[var(--color-accent-hi)]" /><span className="text-[10px] font-semibold text-white/80">0:41</span></div>
        </div>
      )
    case 'segments':
      return (
        <div className={`${box} flex flex-col justify-center gap-2 px-2`}>
          <div className="flex gap-[3px]">{Array.from({ length: 16 }).map((_, i) => <span key={i} className="h-1.5 flex-1 rounded-[2px]" style={{ background: i < 7 ? acc : 'rgba(255,255,255,.14)' }} />)}</div>
          <div className="flex gap-1.5">{dot}{dot}</div>
        </div>
      )
    case 'wavebold':
      return (
        <div className={`${box} flex flex-col justify-center gap-1.5 px-2`}>
          <div className="h-5">{bars(40, 20, 'gap-[2px]', true)}</div>
          <div className="flex items-center gap-2"><span className="h-4 w-4 rounded bg-[var(--color-accent-hi)]" /><span className="text-[10px] font-semibold text-white/80">0:41</span></div>
        </div>
      )
    case 'slim':
    default:
      return <div className={box}><div className="absolute inset-x-0 top-0">{line(3)}</div><div className="absolute inset-x-2 bottom-2 flex gap-1.5">{dot}{dot}</div></div>
  }
}

/* ---------- shared bits ---------- */

/** A titled block within a tab. */
function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }): JSX.Element {
  return (
    <div>
      <div className="mb-2.5 flex items-baseline gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--color-dim)]">{title}</span>
        {hint && <span className="text-[11px] text-[var(--color-dim2,#6b7080)]">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

/** A selectable tile — the shell every picker card shares. */
function Tile({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col gap-2 rounded-xl border p-2.5 text-left transition ${
        on
          ? 'border-[var(--color-accent-hi)] bg-[var(--color-accent)]/12'
          : 'border-white/10 bg-white/[.02] hover:border-white/20 hover:bg-white/[.05]'
      }`}
    >
      {children}
    </button>
  )
}

function TileFooter({ name, on }: { name: string; on: boolean }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between">
      <span className={`text-[12.5px] font-semibold ${on ? 'text-white' : 'text-[#d7dae1]'}`}>{name}</span>
      {on && <span className="text-[10px] font-semibold text-[var(--color-accent-hi)]">Selected</span>}
    </div>
  )
}

/** Whether preset `p` matches the current live settings exactly. */
function isActivePreset(p: Preset, v: VizState): boolean {
  return (
    p.style === v.style &&
    p.height === v.height &&
    p.pos === v.pos &&
    p.width === v.width &&
    p.logo === v.logo &&
    (p.theme ?? DEFAULT_THEME_ID) === v.theme
  )
}

/* ---------- tab bodies ---------- */

function PlayerTab({ transportStyle, onPickTransport }: { transportStyle: TransportStyle; onPickTransport: (s: TransportStyle) => void }): JSX.Element {
  const v = useViz()
  return (
    <div className="flex flex-col gap-6">
      {TRANSPORT_GROUPS.map((g) => {
        const items = TRANSPORT_STYLES.filter((s) => s.group === g)
        if (!items.length) return null
        return (
          <Section key={g} title={g}>
            <div className="grid grid-cols-3 gap-2.5">
              {items.map((s) => {
                const on = s.id === transportStyle
                return (
                  <Tile key={s.id} on={on} onClick={() => onPickTransport(s.id)}>
                    <Mini id={s.id} />
                    <TileFooter name={s.name} on={on} />
                  </Tile>
                )
              })}
            </div>
          </Section>
        )
      })}
      <Section title="Colour" hint="scheme + effects for the progress bar">
        <ColourControls
          selectedId={v.barTheme}
          onPick={setBarTheme}
          glow={v.barGlow}
          cycle={v.barCycle}
          move={v.barMove}
          onGlow={setBarGlow}
          onCycle={setBarCycle}
          onMove={setBarMove}
        />
      </Section>
    </div>
  )
}

/* ---------- general ---------- */

// General reads like a normal settings page: a titled group of rows, each row a
// name + explanation on the left and its control on the right, hairline between.

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }): JSX.Element {
  return (
    <section className="max-w-[720px]">
      <h3 className="text-[15px] font-semibold text-white">{title}</h3>
      {hint && <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--color-dim)]">{hint}</p>}
      <div className="mt-3.5 border-t border-white/[.07]">{children}</div>
    </section>
  )
}

function Row({ id, label, desc, children }: { id: string; label: string; desc?: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-8 border-b border-white/[.07] py-3.5">
      <div className="min-w-0">
        <label htmlFor={id} className="text-[13px] font-semibold text-white">
          {label}
        </label>
        {desc && <p className="mt-0.5 text-[12px] leading-snug text-[var(--color-dim)]">{desc}</p>}
      </div>
      {children}
    </div>
  )
}

/** A dark native select - keyboard and screen-reader behaviour for free, and
 *  Chromium renders its popup dark because :root sets color-scheme. */
function Dropdown({
  id,
  value,
  onChange,
  options
}: {
  id: string
  value: string
  onChange: (v: string) => void
  options: Array<{ id: string; name: string }>
}): JSX.Element {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="shrink-0 rounded-lg border border-white/[.12] bg-white/[.06] px-2.5 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:border-white/25 focus-visible:border-[var(--color-accent-hi)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/45"
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  )
}

function GeneralTab(): JSX.Element {
  const scope = useNavScope()
  const current = NAV_SCOPES.find((s) => s.id === scope) ?? NAV_SCOPES[0]
  return (
    <Group title="Folder navigation" hint="Which sibling files the arrow keys step through after you open one.">
      <Row id="nav-scope" label="Scope" desc={current.desc}>
        <Dropdown id="nav-scope" value={scope} onChange={(v) => setNavScope(v as NavScope)} options={NAV_SCOPES} />
      </Row>
      <p className="pt-3.5 text-[12px] leading-relaxed text-[var(--color-dim)]">
        The file you opened is always in the list, whatever the scope.
      </p>
    </Group>
  )
}

function VisualizerTab(): JSX.Element {
  const v = useViz()
  // Style shows a simple schematic mockup of each shape (min-size cards that
  // reflow), with the colour scheme in its own subsection below.
  return (
    <div className="flex flex-col gap-6">
      <Section title="Style">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-2.5">
          {v.presets.map((p) => {
            const on = isActivePreset(p, v)
            return (
              <Tile key={p.id} on={on} onClick={() => applyPreset(p)}>
                <div className="h-[104px] w-full overflow-hidden rounded-md bg-[#0d0f14]">
                  <VizPreview styleId={p.style} />
                </div>
                <TileFooter name={p.name} on={on} />
              </Tile>
            )
          })}
        </div>
      </Section>
      <Section title="Colour" hint="scheme + effects; recolours every shape">
        <ColourControls
          selectedId={v.theme}
          onPick={setTheme}
          glow={v.glow}
          cycle={v.cycle}
          move={v.move}
          onGlow={setGlow}
          onCycle={setCycle}
          onMove={setMove}
        />
      </Section>
    </div>
  )
}

// Base schemes are just Solid or Gradient (simple -> complex); glow / cycle / move
// are separate effect toggles rather than their own categories.
function colourCategory(t: VizTheme): string {
  return t.palette.length <= 1 ? 'Solid' : 'Gradient'
}
const COLOUR_ORDER = ['Solid', 'Gradient']

// The colour effects, applied on top of any scheme (they all combine). Reused for
// the visualizer and the progress bar, each with its own values + setters.
function EffectToggles({
  glow,
  cycle,
  move,
  onGlow,
  onCycle,
  onMove
}: {
  glow: boolean
  cycle: boolean
  move: boolean
  onGlow: (b: boolean) => void
  onCycle: (b: boolean) => void
  onMove: (b: boolean) => void
}): JSX.Element {
  const toggles: Array<{ label: string; on: boolean; set: (b: boolean) => void }> = [
    { label: 'Glow', on: glow, set: onGlow },
    { label: 'Cycle', on: cycle, set: onCycle },
    { label: 'Move', on: move, set: onMove }
  ]
  return (
    <div className="flex flex-wrap gap-2">
      {toggles.map((tg) => (
        <button
          key={tg.label}
          onClick={() => tg.set(!tg.on)}
          aria-pressed={tg.on}
          className={`rounded-lg border px-3.5 py-1.5 text-[12.5px] font-semibold transition ${
            tg.on
              ? 'border-[var(--color-accent-hi)] bg-[var(--color-accent)]/25 text-white'
              : 'border-white/10 bg-white/[.02] text-[var(--color-dim)] hover:border-white/20 hover:text-white'
          }`}
        >
          {tg.label}
        </button>
      ))}
    </div>
  )
}

// A grid of plain filled colour swatches (no labels; name on hover) - used for
// both the visualizer scheme and the progress-bar colour so they match.
function Swatches({
  items,
  selectedId,
  onPick
}: {
  items: Array<{ id: string; name: string; fill: string }>
  selectedId: string
  onPick: (id: string) => void
}): JSX.Element {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-1.5">
      {items.map((it) => {
        const on = it.id === selectedId
        return (
          <button
            key={it.id}
            onClick={() => onPick(it.id)}
            title={it.name}
            aria-label={it.name}
            aria-pressed={on}
            className={`h-6 rounded-md transition ${
              on
                ? 'ring-2 ring-[var(--color-accent-hi)] ring-offset-1 ring-offset-[#0d0f14]'
                : 'ring-1 ring-white/10 hover:ring-white/30'
            }`}
            style={{ background: it.fill }}
          />
        )
      })}
    </div>
  )
}

// A colour-scheme picker (Solid / Gradient), used for both the visualizer and the
// progress bar with their own selection.
function SchemePicker({ selectedId, onPick }: { selectedId: string; onPick: (id: string) => void }): JSX.Element {
  const themes = visibleThemes()
  return (
    <div className="flex flex-col gap-3">
      {COLOUR_ORDER.map((cat) => {
        const items = themes.filter((t) => colourCategory(t) === cat)
        if (!items.length) return null
        return (
          <div key={cat}>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[.14em] text-[var(--color-dim2,#6b7080)]">{cat}</div>
            <Swatches
              items={items.map((t) => ({
                id: t.id,
                name: t.name,
                fill: t.palette.length > 1 ? `linear-gradient(90deg, ${t.palette.join(', ')})` : t.palette[0]
              }))}
              selectedId={selectedId}
              onPick={onPick}
            />
          </div>
        )
      })}
    </div>
  )
}

// A colour scheme + effect toggles block, shared by the two Colour subsections.
function ColourControls({
  selectedId,
  onPick,
  glow,
  cycle,
  move,
  onGlow,
  onCycle,
  onMove
}: {
  selectedId: string
  onPick: (id: string) => void
  glow: boolean
  cycle: boolean
  move: boolean
  onGlow: (b: boolean) => void
  onCycle: (b: boolean) => void
  onMove: (b: boolean) => void
}): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <SchemePicker selectedId={selectedId} onPick={onPick} />
      <div>
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[.14em] text-[var(--color-dim2,#6b7080)]">Effects</div>
        <EffectToggles glow={glow} cycle={cycle} move={move} onGlow={onGlow} onCycle={onCycle} onMove={onMove} />
      </div>
    </div>
  )
}

/* ---------- tabs shell ---------- */

type TabId = 'general' | 'player' | 'visualizer' | 'about'

const Ico = ({ d }: { d: string }): JSX.Element => (
  <svg viewBox="0 0 24 24" width={17} height={17} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
)

const TABS: Array<{ id: TabId; label: string; title: string; desc: string; icon: ReactNode }> = [
  {
    id: 'general',
    label: 'General',
    title: 'General',
    desc: 'How Prism behaves when you open a file.',
    icon: <Ico d="M4 7h8M16 7h4M4 17h4M12 17h8M12 7a2 2 0 1 0 4 0 2 2 0 1 0-4 0M8 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0" />
  },
  {
    id: 'player',
    label: 'Progress bar',
    title: 'Progress bar',
    desc: "The player's transport - its shape and colour.",
    icon: <Ico d="M4 12h16M8 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0" />
  },
  {
    id: 'visualizer',
    label: 'Visualizer',
    title: 'Visualizer',
    desc: 'The audio visualizer style and colour. Previews are simplified mockups.',
    icon: <Ico d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
  },
  {
    id: 'about',
    label: 'About',
    title: 'About Prism',
    desc: '',
    icon: <Ico d="M12 8h.01M11 12h1v4h1M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z" />
  }
]

export function Settings({
  open,
  onClose,
  transportStyle,
  onPickTransport
}: {
  open: boolean
  onClose: () => void
  transportStyle: TransportStyle
  onPickTransport: (s: TransportStyle) => void
}): JSX.Element | null {
  const [tab, setTab] = useState<TabId>('general')

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null
  const active = TABS.find((t) => t.id === tab) ?? TABS[0]

  return (
    // A full-window settings page (sits below the 36px title bar), not a popup.
    <div className="fixed inset-x-0 bottom-0 top-9 z-40 flex bg-[#0d0f14]">
      {/* tab rail */}
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-white/[.06] bg-[#0e1016] p-3">
          <div className="px-2 pb-3 pt-1.5 text-[15px] font-bold tracking-tight text-white">Settings</div>
          <nav className="flex flex-col gap-0.5">
            {TABS.map((t) => {
              const on = t.id === tab
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition ${
                    on
                      ? 'bg-[var(--color-accent)]/18 text-white'
                      : 'text-[var(--color-dim)] hover:bg-white/[.05] hover:text-white'
                  }`}
                >
                  <span className={on ? 'text-[var(--color-accent-hi)]' : ''}>{t.icon}</span>
                  {t.label}
                </button>
              )
            })}
          </nav>
          <div className="mt-auto px-2 pb-1 text-[11px] text-[var(--color-dim2,#6b7080)]">Prism</div>
        </aside>

        {/* content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-white/[.06] px-6 py-4">
            <div className="min-w-0">
              <h2 className="text-[16px] font-semibold text-white">{active.title}</h2>
              {active.desc && <p className="mt-0.5 truncate text-[12.5px] text-[var(--color-dim)]">{active.desc}</p>}
            </div>
            <button
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--color-dim)] hover:bg-white/10 hover:text-white"
              onClick={onClose}
              aria-label="Close settings"
            >
              ✕
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {tab === 'general' ? (
              <GeneralTab />
            ) : tab === 'player' ? (
              <PlayerTab transportStyle={transportStyle} onPickTransport={onPickTransport} />
            ) : tab === 'visualizer' ? (
              <VisualizerTab />
            ) : (
              <div className="max-w-[46ch] text-[13px] leading-relaxed text-[var(--color-dim)]">
                <div className="mb-1 text-[15px] font-semibold text-white">Prism</div>
                A sleek media viewer — audio visualizer, video, and images in one dark, chrome-light window.
              </div>
            )}
          </div>
        </div>
      </div>
  )
}
