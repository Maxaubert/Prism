import { useEffect, useState, type JSX, type ReactNode } from 'react'
import { TRANSPORT_STYLES, TRANSPORT_GROUPS, type TransportStyle } from '../lib/transport'
import { DEFAULT_THEME_ID } from '../lib/viz/styles'
import type { VizTheme } from '../lib/viz/core'
import {
  useViz,
  visibleThemes,
  applyPreset,
  setTheme,
  setBar,
  BAR_COLORS,
  type Preset,
  type VizState
} from '../lib/vizStore'
import { VizPreview } from './VizPreview'

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
    </div>
  )
}

function VisualizerTab(): JSX.Element {
  const v = useViz()
  // Each style shows a simple schematic mockup of its shape. The cards have a
  // minimum size and reflow into new rows as the window narrows, so a preview
  // never shrinks below a readable size.
  return (
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
  )
}

// Group colour schemes by their EFFECT (how they behave), not by hue, so a user
// can find "a moving gradient" or "a glowing one" directly.
function colourCategory(t: VizTheme): string {
  if (t.cycle) return 'Moving'
  if (t.vgrad) return 'Vertical gradients'
  if (t.glow) return 'Glowing'
  if (t.palette.length <= 1) return 'Solid colours'
  return 'Gradients'
}
const COLOUR_ORDER = ['Gradients', 'Solid colours', 'Vertical gradients', 'Glowing', 'Moving']

function ColoursTab(): JSX.Element {
  const v = useViz()
  const themes = visibleThemes()
  return (
    <div className="flex flex-col gap-6">
      {/* Colour schemes as plain filled swatches (no labels) so the gradients
          read clearly, grouped by effect. */}
      {COLOUR_ORDER.map((cat) => {
        const items = themes.filter((t) => colourCategory(t) === cat)
        if (!items.length) return null
        return (
          <Section key={cat} title={cat}>
            <div className="grid grid-cols-4 gap-2.5 lg:grid-cols-5">
              {items.map((t) => {
                const on = t.id === v.theme
                // Moving swatches: a cyclic gradient (loops back to its first
                // colour) so there's no seam, tiled twice and slid by one tile for
                // a seamless loop. Faster themes scroll faster (Cycle vs Cycle Fast).
                const stops = t.cycle ? [...t.palette, t.palette[0]] : t.palette
                const fill = stops.length > 1 ? `linear-gradient(90deg, ${stops.join(', ')})` : stops[0]
                const dur = t.cycle ? (3.6 * 0.03) / t.cycle : 0
                return (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t.id)}
                    title={t.name}
                    aria-label={t.name}
                    aria-pressed={on}
                    className={`relative h-12 overflow-hidden rounded-lg transition ${
                      on
                        ? 'ring-2 ring-[var(--color-accent-hi)] ring-offset-2 ring-offset-[#0d0f14]'
                        : 'ring-1 ring-white/10 hover:ring-white/30'
                    }`}
                    style={{ boxShadow: t.glow ? `0 0 16px ${t.accent}88` : undefined }}
                  >
                    {t.cycle ? (
                      <span
                        aria-hidden
                        className="absolute inset-y-0 left-0 w-[200%]"
                        style={{ backgroundImage: fill, backgroundSize: '50% 100%', animation: `prism-slide ${dur.toFixed(2)}s linear infinite` }}
                      />
                    ) : (
                      <span aria-hidden className="absolute inset-0" style={{ background: fill }} />
                    )}
                  </button>
                )
              })}
            </div>
          </Section>
        )
      })}

      <Section title="Progress bar colour" hint="the player's played-progress fill">
        <div className="grid grid-cols-4 gap-2.5">
          {BAR_COLORS.map((b) => {
            const on = b.id === v.bar
            return (
              <button
                key={b.id}
                onClick={() => setBar(b.id)}
                className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition ${
                  on
                    ? 'border-[var(--color-accent-hi)] bg-[var(--color-accent)]/12'
                    : 'border-white/10 bg-white/[.02] hover:border-white/20 hover:bg-white/[.05]'
                }`}
              >
                <span
                  className="h-4 w-4 shrink-0 rounded-full ring-1 ring-white/20"
                  style={{ background: b.value }}
                />
                <span className={`truncate text-[12.5px] font-semibold ${on ? 'text-white' : 'text-[#d7dae1]'}`}>{b.label}</span>
              </button>
            )
          })}
        </div>
      </Section>
    </div>
  )
}

/* ---------- tabs shell ---------- */

type TabId = 'player' | 'visualizer' | 'colours' | 'about'

const Ico = ({ d }: { d: string }): JSX.Element => (
  <svg viewBox="0 0 24 24" width={17} height={17} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
)

const TABS: Array<{ id: TabId; label: string; title: string; desc: string; icon: ReactNode }> = [
  {
    id: 'player',
    label: 'Progress bar',
    title: 'Progress bar',
    desc: "The shape of the player's transport. Its colour lives under Colours.",
    icon: <Ico d="M4 12h16M8 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0" />
  },
  {
    id: 'visualizer',
    label: 'Visualizer',
    title: 'Visualizer',
    desc: 'The audio visualizer style. Previews are simplified mockups of each shape.',
    icon: <Ico d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
  },
  {
    id: 'colours',
    label: 'Colours',
    title: 'Colours',
    desc: 'The visualizer colour scheme and the progress-bar colour.',
    icon: <Ico d="M12 3v18M3 12h18M6 6l12 12M18 6 6 18" />
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
  const [tab, setTab] = useState<TabId>('player')

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
            {tab === 'player' ? (
              <PlayerTab transportStyle={transportStyle} onPickTransport={onPickTransport} />
            ) : tab === 'visualizer' ? (
              <VisualizerTab />
            ) : tab === 'colours' ? (
              <ColoursTab />
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
