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
import { setAutoScroll, setTreeSize, TREE_SIZES, useAutoScroll, useTreeSize, type TreeSize } from '../lib/treePrefs'
import {
  FONTS,
  acrylicLevel,
  deletePreset,
  paletteOf,
  savePreset,
  setAcrylic,
  setMode,
  setOverride,
  setStyle,
  useMode,
  useOverrides,
  useSelectedId,
  useStyle,
  useStyles,
  mix,
  rgba,
  type FontId,
  type Mode,
  type Style
} from '../lib/theme'

// The app-wide Settings window: a large pop-up with a left tab rail and a content
// pane, so it reads like a real settings page. It and the in-canvas gear panel are
// two views over the same vizStore — a change in one shows in the other live.

/** A small schematic of each transport style, so the picker previews the shape
 *  without spinning up a real player. */
function Mini({ id }: { id: TransportStyle }): JSX.Element {
  const acc = 'var(--p-accent-hi)'
  const box =
    'relative h-11 w-full overflow-hidden rounded-md border border-[color:var(--p-divider)] bg-[var(--p-preview)]'
  const dot = <span className="h-2 w-2 rounded-full bg-[var(--p-track)]" />
  const bars = (n: number, h: number, gap: string, bold = false): JSX.Element => (
    <div className={`flex w-full items-center ${gap}`}>
      {Array.from({ length: n }).map((_, i) => (
        <span
          key={i}
          className="flex-1 rounded-[1px]"
          style={{
            height: `${(bold ? h : h * 0.85) * (0.35 + 0.65 * Math.abs(Math.sin(i * 0.7) * Math.cos(i * 0.19)))}px`,
            background: i / n < 0.42 ? acc : 'var(--p-track)'
          }}
        />
      ))}
    </div>
  )
  const line = (h: number, glow = false): JSX.Element => (
    <div className="relative w-full rounded-full bg-[var(--p-track)]" style={{ height: h }}>
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: '42%', background: acc, boxShadow: glow ? `0 0 6px ${acc}` : undefined }} />
    </div>
  )

  switch (id) {
    case 'edge':
      return (
        <div className={box}>
          <div className="absolute inset-x-2 bottom-2 flex items-center gap-1.5 text-[var(--p-dim)]">{dot}<span className="text-[9px] text-[var(--p-dim)]">controls</span></div>
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
          <div className="flex items-center gap-1.5 rounded-full border border-[color:var(--p-track)] bg-[var(--p-hover)] px-2 py-1">{dot}<div className="w-14">{line(3)}</div></div>
        </div>
      )
    case 'wave':
      return <div className={`${box} flex flex-col justify-center gap-1.5 px-2`}><div className="h-4">{bars(52, 16, 'gap-[1.5px]')}</div><div className="flex gap-1.5">{dot}{dot}</div></div>
    case 'outline':
      return (
        <div className={box}>
          <div className="absolute inset-x-2 top-2">{line(2, true)}</div>
          <div className="absolute inset-x-2 bottom-2 flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full border border-[color:var(--p-track)]" /><span className="h-2.5 w-2.5 rounded-full border border-[color:var(--p-track)]" />
          </div>
        </div>
      )
    case 'bold':
      return (
        <div className={box}>
          <div className="absolute inset-x-0 top-0">{line(4)}</div>
          <div className="absolute inset-x-2 bottom-1.5 flex items-center gap-2"><span className="h-4 w-4 rounded bg-[var(--p-accent-hi)]" /><span className="text-[10px] font-semibold text-[var(--p-text-soft)]">0:41</span></div>
        </div>
      )
    case 'segments':
      return (
        <div className={`${box} flex flex-col justify-center gap-2 px-2`}>
          <div className="flex gap-[3px]">{Array.from({ length: 16 }).map((_, i) => <span key={i} className="h-1.5 flex-1 rounded-[2px]" style={{ background: i < 7 ? acc : 'var(--p-track)' }} />)}</div>
          <div className="flex gap-1.5">{dot}{dot}</div>
        </div>
      )
    case 'wavebold':
      return (
        <div className={`${box} flex flex-col justify-center gap-1.5 px-2`}>
          <div className="h-5">{bars(40, 20, 'gap-[2px]', true)}</div>
          <div className="flex items-center gap-2"><span className="h-4 w-4 rounded bg-[var(--p-accent-hi)]" /><span className="text-[10px] font-semibold text-[var(--p-text-soft)]">0:41</span></div>
        </div>
      )
    case 'slim':
    default:
      return <div className={box}><div className="absolute inset-x-0 top-0">{line(3)}</div><div className="absolute inset-x-2 bottom-2 flex gap-1.5">{dot}{dot}</div></div>
  }
}

/* ---------- shared bits ---------- */

/** A titled block within a tab. One label, no explanation: if a section needs a
 *  sentence to justify itself, it is in the wrong place. */
function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-4">
        <span className="text-[10px] font-semibold uppercase tracking-[.14em] text-[var(--p-dim)]">{title}</span>
        {action}
      </div>
      {children}
    </div>
  )
}

/** A real on/off switch: one control, one state, no pair of buttons to compare. */
function Switch({ on, onChange, label }: { on: boolean; onChange: (b: boolean) => void; label: string }): JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-[20px] w-[36px] shrink-0 rounded-full transition-colors ${
        on ? 'bg-[var(--p-accent)]' : 'bg-[var(--p-track)]'
      }`}
    >
      <span
        className="absolute left-[2px] top-[2px] h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-150 ease-out"
        style={{ transform: on ? 'translateX(16px)' : 'none' }}
      />
    </button>
  )
}

/** A label with its switch, sized to sit beside others on one line. */
function SwitchItem({ label, on, onChange }: { label: string; on: boolean; onChange: (b: boolean) => void }): JSX.Element {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-[12.5px] font-medium text-[var(--p-text-soft)]">
      {label}
      <Switch on={on} onChange={onChange} label={label} />
    </label>
  )
}

/** A colour well that opens the system picker, with its hex and a way back. */
function ColourWell({
  id,
  value,
  custom,
  onChange,
  onReset
}: {
  id: string
  value: string
  custom: boolean
  onChange: (v: string) => void
  onReset: () => void
}): JSX.Element {
  return (
    <div className="flex items-center gap-2.5">
      {custom && (
        <button onClick={onReset} className="text-[11px] font-semibold text-[var(--p-accent-hi)] hover:underline">
          Reset
        </button>
      )}
      <span className="font-mono text-[11.5px] uppercase text-[var(--p-dim)]">{value}</span>
      <label
        className="relative block h-7 w-9 cursor-pointer overflow-hidden rounded-[var(--p-radius-sm)] border border-[color:var(--p-line)]"
        style={{ background: value }}
      >
        <input
          id={id}
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
    </div>
  )
}

/** Two or three exclusive choices as one control rather than a row of buttons. */
function Segmented<T extends string>({
  value,
  onChange,
  options
}: {
  value: T
  onChange: (v: T) => void
  options: Array<{ id: T; name: string }>
}): JSX.Element {
  return (
    <div className="inline-flex gap-0.5 rounded-full border border-[color:var(--p-divider)] bg-[var(--p-preview)] p-[3px]">
      {options.map((o) => {
        const on = o.id === value
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            aria-pressed={on}
            className={`rounded-full px-3 py-1 text-[11.5px] font-semibold capitalize transition ${
              on
                ? 'bg-[var(--p-accent)] text-[var(--p-on-accent)]'
                : 'text-[var(--p-dim)] hover:text-[var(--p-text)]'
            }`}
          >
            {o.name}
          </button>
        )
      })}
    </div>
  )
}

// Picker grids are sized, not counted: fixed-width columns that wrap. A
// fractional grid stretched three cards across a wide window and squeezed six
// into slivers, and the schematic inside each card went with it.
const GRID = 'grid grid-cols-[repeat(auto-fill,268px)] gap-2.5'
const GRID_SM = 'grid grid-cols-[repeat(auto-fill,224px)] gap-2.5'

/** A selectable tile — the shell every picker card shares. A div rather than a
 *  button so a card can carry its own controls (a preset's delete). */
function Tile({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }): JSX.Element {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      className={`group relative flex cursor-pointer flex-col gap-1.5 rounded-[var(--p-radius)] border p-2 text-left transition ${
        on
          ? 'border-[var(--p-accent)] bg-[var(--p-accent)]/12 shadow-[0_0_0_2px_var(--p-accent)]'
          : 'border-[color:var(--p-divider)] bg-[var(--p-hover)] hover:border-[color:var(--p-dim2)]'
      }`}
    >
      {children}
    </div>
  )
}

// The name, and nothing else: the ring already says which card is chosen, so a
// "Selected" caption is the same fact written twice.
function TileFooter({ name, on }: { name: string; on: boolean }): JSX.Element {
  return (
    <span className={`text-[12.5px] font-semibold ${on ? 'text-[var(--p-text)]' : 'text-[var(--p-text-soft)]'}`}>
      {name}
    </span>
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
    <div className="flex flex-col gap-4">
      {TRANSPORT_GROUPS.map((g) => {
        const items = TRANSPORT_STYLES.filter((s) => s.group === g)
        if (!items.length) return null
        return (
          <Section key={g} title={g}>
            <div className={GRID_SM}>
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
      <Section title="Colour">
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

/* ---------- style ---------- */

/** A miniature of the main window in a given style: the card IS the preview. */
function StyleMini({ st }: { st: Style }): JSX.Element {
  const palette = paletteOf(st.accent)
  const accent = palette[0]
  const paint = palette.length > 1 ? `linear-gradient(90deg, ${palette.join(', ')})` : accent
  const tint = st.material === 'tinted'
  const grad = st.material === 'gradient'
  const side = tint ? mix(st.side, accent, 0.1) : grad ? `linear-gradient(180deg, ${mix(st.side, '#ffffff', 0.06)}, ${st.side})` : st.side
  const title = tint ? mix(st.title, accent, 0.12) : st.title
  const bg = tint ? mix(st.bg, accent, 0.07) : st.bg
  const dim = mix(st.text, st.side, 0.5)
  const line = (w: string, c: string): JSX.Element => (
    <span className="block h-[3px] rounded-[2px]" style={{ width: w, background: c }} />
  )
  return (
    <div className="flex h-[104px] flex-col overflow-hidden rounded-md" style={{ border: '1px solid var(--p-divider)' }}>
      <div className="flex h-[9px] shrink-0 items-center gap-[3px] px-1.5" style={{ background: title }}>
        <span className="h-[2.5px] w-[2.5px] rounded-[1px]" style={{ background: accent }} />
        {line('30%', rgba(st.text, 0.5))}
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[36%] flex-col gap-[3px] p-1.5" style={{ background: side }}>
          {line('62%', rgba(dim, 0.6))}
          {line('80%', rgba(st.text, 0.5))}
          <span className="block h-[3px] rounded-[2px]" style={{ width: '72%', background: paint }} />
          {line('86%', rgba(st.text, 0.3))}
          {line('68%', rgba(st.text, 0.3))}
        </div>
        <div className="relative flex-1" style={{ background: bg }}>
          <div className="absolute left-1/2 top-1/2 h-[46%] w-[62%] -translate-x-1/2 -translate-y-1/2 rounded-[3px] bg-[linear-gradient(140deg,#7d1f2a,#b03a2e_45%,#2c3e63)]" />
          <div className="absolute inset-x-2 bottom-1.5 h-[2.5px] rounded-[2px]" style={{ background: rgba(st.text, 0.18) }}>
            <span className="block h-full w-[44%] rounded-[2px]" style={{ background: paint }} />
          </div>
        </div>
      </div>
    </div>
  )
}

const FONT_OPTIONS: Array<{ id: FontId; name: string }> = (
  Object.keys(FONTS) as FontId[]
).map((id) => ({ id, name: FONTS[id].name }))

const MODE_OPTIONS: Array<{ id: Mode; name: string }> = [
  { id: 'dark', name: 'Dark' },
  { id: 'light', name: 'Light' }
]

function StyleTab(): JSX.Element {
  const style = useStyle()
  const mode = useMode()
  const edits = useOverrides()
  const selected = useSelectedId()
  const list = useStyles(mode)
  const dirty = !!(edits.accent || edits.bg || edits.text || edits.acrylic !== undefined)
  const glass = acrylicLevel(style)
  return (
    <div className="flex flex-col gap-5">
      {/* Mode is a setting like any other, so it gets a row of its own rather
          than a control tucked into the page header. */}
      <div className={ROWS}>
        <Pref id="mode" label="Mode" hint="Dark and light keep their own styles.">
          <Segmented value={mode} onChange={setMode} options={MODE_OPTIONS} />
        </Pref>
      </div>

      {/* Once a colour is changed nothing here is selected: what is on screen is
          no longer any of these. Clicking one is how you go back to it. */}
      <div className={GRID}>
        {list.map((st) => {
          const on = st.id === selected
          return (
            <Tile key={st.id} on={on} onClick={() => setStyle(st.id)}>
              <StyleMini st={st.id === style.id ? style : st} />
              <div className="flex items-center justify-between gap-2">
                <TileFooter name={st.name} on={on} />
                {st.custom && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      deletePreset(st.id)
                    }}
                    aria-label={`Delete ${st.name}`}
                    title="Delete preset"
                    className="grid h-5 w-5 shrink-0 place-items-center rounded-[var(--p-radius-sm)] text-[var(--p-dim2)] opacity-0 transition hover:bg-[var(--p-hover)] hover:text-[var(--p-text)] focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                )}
              </div>
            </Tile>
          )
        })}
      </div>

      {/* Colours live with the style they change, not in a tab of their own:
          a style is a starting point you tune, and the cards above show it. */}
      <Section
        title="Colours"
        // The button is only usable while there is an edit to save, but it keeps
        // its space either way: a control that appears must not move the page.
        action={
          <button
            onClick={savePreset}
            aria-hidden={!dirty}
            tabIndex={dirty ? 0 : -1}
            className={`rounded-[var(--p-radius-sm)] border border-[var(--p-accent)] bg-[var(--p-accent)] px-3 py-1 text-[11.5px] font-semibold text-[var(--p-on-accent)] transition hover:brightness-110 ${
              dirty ? '' : 'invisible'
            }`}
          >
            Save as preset
          </button>
        }
      >
        <div className={ROWS}>
          <Pref id="c-bg" label="Background" hint="The viewer behind your file.">
            <ColourWell
              id="c-bg"
              value={style.bg}
              custom={!!edits.bg}
              onChange={(v) => setOverride('bg', v)}
              onReset={() => setOverride('bg', null)}
            />
          </Pref>
          <Pref id="c-text" label="Text" hint="File names, labels and readouts.">
            <ColourWell
              id="c-text"
              value={style.text}
              custom={!!edits.text}
              onChange={(v) => setOverride('text', v)}
              onReset={() => setOverride('text', null)}
            />
          </Pref>
          <Pref id="c-font" label="Font" hint="The typeface the app sets in.">
            <Select
              id="c-font"
              value={style.font}
              onChange={(v) => setOverride('font', v)}
              options={FONT_OPTIONS}
            />
          </Pref>
          <Pref id="c-glass" label="Acrylic" hint="How much of the desktop shows through.">
            <div className="flex items-center gap-3">
              {edits.acrylic !== undefined && (
                <button
                  onClick={() => setAcrylic(null)}
                  className="text-[11px] font-semibold text-[var(--p-accent-hi)] hover:underline"
                >
                  Reset
                </button>
              )}
              <span className="w-[34px] text-right font-mono text-[11.5px] text-[var(--p-dim)]">{glass}%</span>
              <input
                id="c-glass"
                type="range"
                min={0}
                max={100}
                step={1}
                value={glass}
                onChange={(e) => setAcrylic(Number(e.target.value))}
                className="h-1.5 w-[180px] cursor-pointer appearance-none rounded-full bg-[var(--p-track)]"
                style={{ accentColor: 'var(--p-accent)' }}
              />
            </div>
          </Pref>
        </div>
        <div className="mt-3 flex items-center justify-between gap-6">
          <div>
            <div className="text-[12.5px] font-semibold text-[var(--p-text)]">Accent</div>
            <p className="text-[11.5px] text-[var(--p-dim)]">Selection, progress bar and visualizer.</p>
          </div>
          {/* Always the colour that is actually on screen, whether it came from a
              swatch or from here. */}
          <ColourWell
            id="c-accent"
            value={paletteOf(style.accent)[0]}
            custom={!!edits.accent}
            onChange={(v) => setOverride('accent', v)}
            onReset={() => setOverride('accent', null)}
          />
        </div>
        <div className="h-2" />
        <Swatches
          items={visibleThemes().map((th) => ({
            id: th.id,
            name: th.name,
            fill: th.palette.length > 1 ? `linear-gradient(90deg, ${th.palette.join(', ')})` : th.palette[0]
          }))}
          selectedId={style.accent}
          onPick={(id) => setOverride('accent', id)}
        />
      </Section>
    </div>
  )
}

/* ---------- general ---------- */

// General is a plain list: one row per setting, name + one line of explanation
// on the left, its control on the right, hairline between. No panels — the
// page is short enough that grouping it would be ceremony.

// A list of preference rows, hairline above and below each one. Full width: the
// control sits at the right edge of the page, where the eye already is.
const ROWS = 'border-t border-[color:var(--p-line)]'

/** One setting: copy on the left, control on the right. The hint is one line —
 *  it truncates rather than wraps, because a setting that needs a paragraph
 *  needs a better name instead. */
function Pref({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-8 border-b border-[color:var(--p-line)] py-2.5">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-[12.5px] font-semibold text-[var(--p-text)]">
          {label}
        </label>
        {hint && <p className="mt-0.5 truncate text-[11.5px] text-[var(--p-dim)]">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/** A native select - keyboard and screen-reader behaviour for free, and Chromium
 *  renders its popup in the right scheme because :root sets color-scheme. */
function Select({
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
      className="h-8 min-w-[168px] rounded-lg border border-[color:var(--p-divider)] bg-[var(--p-preview)] px-2.5 text-[12px] font-medium text-[var(--p-text)] transition-colors hover:border-[color:var(--p-dim2)] focus-visible:border-[var(--p-accent-hi)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--p-accent)]/45"
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
  const size = useTreeSize()
  const follow = useAutoScroll()
  const current = NAV_SCOPES.find((s) => s.id === scope)
  return (
    <div className={ROWS}>
      <Pref id="nav-scope" label="Navigation mode" hint={current?.hint}>
        <Select id="nav-scope" value={scope} onChange={(v) => setNavScope(v as NavScope)} options={NAV_SCOPES} />
      </Pref>
      <Pref id="tree-size" label="Font size" hint="Sidebar rows and this page.">
        <Select id="tree-size" value={size.id} onChange={(v) => setTreeSize(v as TreeSize)} options={TREE_SIZES} />
      </Pref>
      <Pref id="auto-scroll" label="Auto scroll" hint="The sidebar follows the file you are viewing.">
        <Switch on={follow} onChange={setAutoScroll} label="Auto scroll" />
      </Pref>
    </div>
  )
}

function VisualizerTab(): JSX.Element {
  const v = useViz()
  // Style shows a simple schematic mockup of each shape (min-size cards that
  // reflow), with the colour scheme in its own subsection below.
  return (
    <div className="flex flex-col gap-4">
      <Section title="Style">
        <div className={GRID}>
          {v.presets.map((p) => {
            const on = isActivePreset(p, v)
            return (
              <Tile key={p.id} on={on} onClick={() => applyPreset(p)}>
                <div className="h-[104px] w-full overflow-hidden rounded-md border border-[color:var(--p-divider)] bg-[var(--p-preview)]">
                  <VizPreview styleId={p.style} />
                </div>
                <TileFooter name={p.name} on={on} />
              </Tile>
            )
          })}
        </div>
      </Section>
      <Section title="Colour">
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
    <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
      {toggles.map((tg) => (
        <SwitchItem key={tg.label} label={tg.label} on={tg.on} onChange={tg.set} />
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
    <div className="grid grid-cols-[repeat(auto-fill,74px)] gap-1.5">
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
                ? 'ring-2 ring-[var(--p-accent-hi)] ring-offset-1 ring-offset-[#0d0f14]'
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
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[.14em] text-[var(--p-dim2)]">{cat}</div>
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
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[.14em] text-[var(--p-dim2)]">Effects</div>
        <EffectToggles glow={glow} cycle={cycle} move={move} onGlow={onGlow} onCycle={onCycle} onMove={onMove} />
      </div>
    </div>
  )
}

/* ---------- tabs shell ---------- */

type TabId = 'style' | 'general' | 'player' | 'visualizer' | 'about'

const Ico = ({ d }: { d: string }): JSX.Element => (
  <svg viewBox="0 0 24 24" width={17} height={17} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
)

const TABS: Array<{ id: TabId; label: string; title: string; icon: ReactNode }> = [
  {
    id: 'style',
    label: 'Style',
    title: 'Style',
    icon: <Ico d="M12 3a9 9 0 1 0 0 18 3 3 0 0 0 0-6 3 3 0 0 1 0-6h3a6 6 0 0 0-3-6ZM7.5 10.5h.01M10 7h.01M14 7h.01" />
  },
  {
    id: 'general',
    label: 'General',
    title: 'General',
    icon: <Ico d="M4 7h8M16 7h4M4 17h4M12 17h8M12 7a2 2 0 1 0 4 0 2 2 0 1 0-4 0M8 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0" />
  },
  {
    id: 'player',
    label: 'Progress bar',
    title: 'Progress bar',
    icon: <Ico d="M4 12h16M8 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0" />
  },
  {
    id: 'visualizer',
    label: 'Visualizer',
    title: 'Visualizer',
    icon: <Ico d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
  },
  {
    id: 'about',
    label: 'About',
    title: 'About Prism',
    icon: <Ico d="M12 8h.01M11 12h1v4h1M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z" />
  }
]

// The rail is grouped rather than one flat list: five entries split two ways
// says more about where a setting lives than five in a row does.
const RAIL_GROUPS: Array<{ name: string; tabs: TabId[] }> = [
  { name: 'Look', tabs: ['style', 'visualizer', 'player'] },
  { name: 'Behaviour', tabs: ['general', 'about'] }
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
  const [tab, setTab] = useState<TabId>('style')
  const size = useTreeSize()

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
    // Settings keeps the system font whatever the style says. A style's
    // typeface belongs to the app you're looking at; letting it set the type in
    // here means picking a mono or a serif style resizes the settings page
    // itself, and the cards you're choosing between move as you read them.
    <div
      className="fixed inset-x-0 bottom-0 top-9 z-40 bg-[var(--p-bg)]"
      style={{ fontFamily: FONTS.system.stack, fontSize: '12.5px' }}
    >
     <div className="flex h-full w-full" style={{ zoom: size.zoom }}>
      {/* tab rail, grouped: what Prism looks like, then how it behaves */}
      <aside className="flex w-[212px] shrink-0 flex-col border-r border-[var(--p-divider)] bg-[var(--p-side)] p-2.5">
          <div className="px-2 pb-1 pt-1 text-[14px] font-bold tracking-tight text-[var(--p-text)]">Settings</div>
          {RAIL_GROUPS.map((g) => (
            <nav key={g.name} className="flex flex-col gap-0.5">
              <div className="px-2 pb-1 pt-3 text-[10px] font-bold uppercase tracking-[.14em] text-[var(--p-dim2)]">
                {g.name}
              </div>
              {g.tabs.map((id) => {
                const t = TABS.find((x) => x.id === id)
                if (!t) return null
                const on = t.id === tab
                return (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`flex items-center gap-2.5 rounded-[var(--p-radius-sm)] px-2.5 py-[7px] text-left text-[13px] transition ${
                      on
                        ? 'bg-[var(--p-sel-bg)] font-semibold text-[var(--p-on-accent)]'
                        : 'font-medium text-[var(--p-dim)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]'
                    }`}
                  >
                    <span className={on ? 'opacity-90' : ''}>{t.icon}</span>
                    {t.label}
                  </button>
                )
              })}
            </nav>
          ))}
          <div className="mt-auto px-2 pb-0.5 text-[10.5px] text-[var(--p-dim2)]">Prism</div>
        </aside>

        {/* content */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* No close button: the cog that opened this closes it, and Escape works
              too. One control, one place. */}
          <header className="px-6 pb-3 pt-5">
            <h2 className="text-[21px] font-bold leading-none tracking-[-.022em] text-[var(--p-text)]">{active.title}</h2>
          </header>

          <div className="p-scroll min-h-0 flex-1 overflow-y-auto px-6 py-2">
            {tab === 'style' ? (
              <StyleTab />
            ) : tab === 'general' ? (
              <GeneralTab />
            ) : tab === 'player' ? (
              <PlayerTab transportStyle={transportStyle} onPickTransport={onPickTransport} />
            ) : tab === 'visualizer' ? (
              <VisualizerTab />
            ) : (
              <p className="max-w-[46ch] text-[12.5px] leading-relaxed text-[var(--p-dim)]">
                A quick viewer for images, video, audio and documents.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
