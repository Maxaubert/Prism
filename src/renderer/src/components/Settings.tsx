import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import { TRANSPORT_STYLES, TRANSPORT_GROUPS, type TransportStyle } from '../lib/transport'
import { ACCENT_THEME_ID, DEFAULT_THEME_ID } from '../lib/viz/styles'
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
import { StyleMini } from './StyleMini'
import { savedShellId, saveShellId } from '../lib/termPrefs'
import { setConfirmCloseTabs, useConfirmCloseTabs } from '../lib/tabPrefs'
import { setNewTabMode, setNewTabShow, useNewTabFolder, useNewTabMode, useNewTabShow, type NewTabShow } from '../lib/newTabPrefs'
import { FONT_PCTS, TERM_FONTS, TERM_EXTRA_DEFAULTS, applyCustomExtras, resetTermExtras, saveCustomTermTheme, setAgentColor, setAgentIndicator, setTermAcrylic, setTermFontId, setTermFontPct, setTermThemeId, termThemeId, useAgentColor, useAgentIndicator, useCustomTermTheme, useTermAcrylic, useTermFontId, useTermFontPct, useTermThemeId, type AgentIndicator, type CustomTermTheme } from '../lib/termLook'
import { readTermTheme, resolveTermTheme, TERM_PRESETS, watchTermTheme } from '../lib/termTheme'
import { deriveAnsi, luminance, normalizeColor } from '../lib/termAnsi'
import {
  setAutoScroll,
  setTreeSide,
  setTreeSize,
  TREE_SIDES,
  TREE_SIZES,
  useAutoScroll,
  useTreeSide,
  useTreeSize,
  type TreeSide,
  type TreeSize
} from '../lib/treePrefs'
import {
  FONTS,
  acrylicLevel,
  deletePreset,
  isEdited,
  paletteOf,
  fileIconOf,
  folderIconOf,
  resolveVizTheme,
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
      <div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ width: '42%', background: acc, boxShadow: glow ? `0 0 6px ${acc}` : undefined }}
      />
    </div>
  )

  switch (id) {
    case 'edge':
      return (
        <div className={box}>
          <div className="absolute inset-x-2 bottom-2 flex items-center gap-1.5 text-[var(--p-dim)]">
            {dot}
            <span className="text-[9px] text-[var(--p-dim)]">controls</span>
          </div>
          <div className="absolute inset-x-0 bottom-0">{line(2, true)}</div>
        </div>
      )
    case 'pill':
      return (
        <div className={`${box} flex flex-col justify-center gap-2 px-2`}>
          {line(7)}
          <div className="flex gap-1.5">
            {dot}
            {dot}
          </div>
        </div>
      )
    case 'inline':
      return (
        <div className={`${box} flex items-center gap-1.5 px-2`}>
          {dot}
          <div className="flex-1">{line(3)}</div>
          {dot}
        </div>
      )
    case 'island':
      return (
        <div className={`${box} grid place-items-center`}>
          <div className="flex items-center gap-1.5 rounded-full border border-[color:var(--p-track)] bg-[var(--p-hover)] px-2 py-1">
            {dot}
            <div className="w-14">{line(3)}</div>
          </div>
        </div>
      )
    case 'wave':
      return (
        <div className={`${box} flex flex-col justify-center gap-1.5 px-2`}>
          <div className="h-4">{bars(52, 16, 'gap-[1.5px]')}</div>
          <div className="flex gap-1.5">
            {dot}
            {dot}
          </div>
        </div>
      )
    case 'outline':
      return (
        <div className={box}>
          <div className="absolute inset-x-2 top-2">{line(2, true)}</div>
          <div className="absolute inset-x-2 bottom-2 flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full border border-[color:var(--p-track)]" />
            <span className="h-2.5 w-2.5 rounded-full border border-[color:var(--p-track)]" />
          </div>
        </div>
      )
    case 'bold':
      return (
        <div className={box}>
          <div className="absolute inset-x-0 top-0">{line(4)}</div>
          <div className="absolute inset-x-2 bottom-1.5 flex items-center gap-2">
            <span className="h-4 w-4 rounded bg-[var(--p-accent-hi)]" />
            <span className="text-[10px] font-semibold text-[var(--p-text-soft)]">0:41</span>
          </div>
        </div>
      )
    case 'segments':
      return (
        <div className={`${box} flex flex-col justify-center gap-2 px-2`}>
          <div className="flex gap-[3px]">
            {Array.from({ length: 16 }).map((_, i) => (
              <span
                key={i}
                className="h-1.5 flex-1 rounded-[2px]"
                style={{ background: i < 7 ? acc : 'var(--p-track)' }}
              />
            ))}
          </div>
          <div className="flex gap-1.5">
            {dot}
            {dot}
          </div>
        </div>
      )
    case 'wavebold':
      return (
        <div className={`${box} flex flex-col justify-center gap-1.5 px-2`}>
          <div className="h-5">{bars(40, 20, 'gap-[2px]', true)}</div>
          <div className="flex items-center gap-2">
            <span className="h-4 w-4 rounded bg-[var(--p-accent-hi)]" />
            <span className="text-[10px] font-semibold text-[var(--p-text-soft)]">0:41</span>
          </div>
        </div>
      )
    case 'slim':
    default:
      return (
        <div className={box}>
          <div className="absolute inset-x-0 top-0">{line(3)}</div>
          <div className="absolute inset-x-2 bottom-2 flex gap-1.5">
            {dot}
            {dot}
          </div>
        </div>
      )
  }
}

/* ---------- shared bits ---------- */

/** A titled block within a tab. One label, no explanation: if a section needs a
 *  sentence to justify itself, it is in the wrong place. */
function Section({
  title,
  action,
  children
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}): JSX.Element {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-4">
        <span className="text-[10px] font-semibold uppercase tracking-[.14em] text-[var(--p-dim)]">
          {title}
        </span>
        {action}
      </div>
      {children}
    </div>
  )
}

/** A real on/off switch: one control, one state, no pair of buttons to compare. */
function Switch({
  on,
  onChange,
  label
}: {
  on: boolean
  onChange: (b: boolean) => void
  label: string
}): JSX.Element {
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
function SwitchItem({
  label,
  on,
  onChange
}: {
  label: string
  on: boolean
  onChange: (b: boolean) => void
}): JSX.Element {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-[12.5px] font-medium text-[var(--p-text-soft)]">
      {label}
      <Switch on={on} onChange={onChange} label={label} />
    </label>
  )
}

/**
 * A colour well: type a hex, or open the system picker.
 *
 * The hex is a field rather than a readout - a colour you already know is
 * quicker typed than hunted for in a picker, and it is how a colour arrives
 * from anywhere else. It is held as text while you edit and only applied when
 * it parses, so half-typed values don't repaint the app on every keystroke.
 */
/** "#abc", "abc", "#aabbcc" → "#aabbcc"; anything else → null. */
function parseHexInput(raw: string): string | null {
  const hex = '#' + raw.trim().replace(/^#/, '')
  const full = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' +
      hex
        .slice(1)
        .split('')
        .map((c) => c + c)
        .join('')
    : hex
  return /^#[0-9a-f]{6}$/i.test(full) ? full.toLowerCase() : null
}

/** The compact colour control: a hex field and a swatch. Every place a colour
 *  is chosen carries the field - a picker without one strands anyone pasting
 *  a code from elsewhere. */
function HexSwatch({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange: (v: string) => void
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? value
  const commit = (raw: string): void => {
    setDraft(null)
    const full = parseHexInput(raw)
    if (full) onChange(full)
  }
  return (
    <span className="flex items-center gap-1.5">
      <input
        value={text}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(text)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(text)
          else if (e.key === 'Escape') setDraft(null)
        }}
        spellCheck={false}
        aria-label={`${label} hex value`}
        className="w-[64px] rounded-[var(--p-radius-sm)] border border-[color:var(--p-line)] bg-[var(--p-control)] px-1 py-0.5 text-center font-mono text-[10.5px] uppercase text-[var(--p-text)] focus-visible:border-[var(--p-accent-hi)] focus-visible:outline-none"
      />
      <label
        className="relative block h-6 w-9 cursor-pointer overflow-hidden rounded-[var(--p-radius-sm)] border border-[color:var(--p-line)]"
        style={{ background: value }}
        title="Pick a colour"
      >
        <input
          type="color"
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
    </span>
  )
}

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
  // While you are typing the field holds the draft; the rest of the time it is
  // simply the colour. No effect syncing the two, which is a render loop
  // waiting to happen.
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? value

  const commit = (raw: string): void => {
    setDraft(null) // either it took, or the field goes back to the colour
    const full = parseHexInput(raw)
    if (full) onChange(full)
  }

  return (
    <div className="flex items-center gap-2.5">
      {custom && (
        <button
          onClick={onReset}
          className="text-[11px] font-semibold text-[var(--p-accent-hi)] hover:underline"
        >
          Reset
        </button>
      )}
      <input
        value={text}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(text)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(text)
          else if (e.key === 'Escape') setDraft(null)
        }}
        spellCheck={false}
        aria-label="Hex value"
        className="w-[76px] rounded-[var(--p-radius-sm)] border border-[color:var(--p-line)] bg-[var(--p-control)] px-1.5 py-1 text-center font-mono text-[11.5px] uppercase text-[var(--p-text)] focus-visible:border-[var(--p-accent-hi)] focus-visible:outline-none"
      />
      <label
        className="relative block h-7 w-9 cursor-pointer overflow-hidden rounded-[var(--p-radius-sm)] border border-[color:var(--p-line)]"
        style={{ background: value }}
        title="Pick a colour"
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
    <div className="inline-flex gap-0.5 rounded-full border border-[color:var(--p-line)] bg-[var(--p-control)] p-[3px]">
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

// Picker grids are bounded, not stretched: a plain fractional grid pulled three
// cards across a wide window and squeezed six into slivers, taking the schematic
// inside each card with it. So the track is free to flex but the card is capped:
// it fills what it is given up to its full size, shrinks by at most a quarter as
// the window narrows, and only then does the row drop a column.
//
// The cap has to live on the card, not the track: with `minmax(min, max)` and
// two definite lengths, auto-fill counts columns using the *max*, so the cards
// never shrink at all - which is what the first attempt at this did.
const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(201px,1fr))] gap-2.5 [&>*]:max-w-[268px]'
const GRID_SM = 'grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2.5 [&>*]:max-w-[224px]'

/** A selectable tile — the shell every picker card shares. A div rather than a
 *  button so a card can carry its own controls (a preset's delete). */
/** The one save button, worn identically by the style and terminal tabs:
 *  accent while there is something to save, quietly grey when there is not. */
function SaveButton({ dirty, onClick, title }: { dirty: boolean; onClick: () => void; title: string }): JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={!dirty}
      title={dirty ? title : 'Nothing to save yet'}
      className={`shrink-0 rounded-[var(--p-radius-sm)] border px-3 py-1 text-[11.5px] font-semibold transition ${
        dirty
          ? 'border-[var(--p-accent)] bg-[var(--p-accent)] text-[var(--p-on-accent)] hover:brightness-110'
          : 'cursor-default border-[color:var(--p-line)] bg-[var(--p-hover)] text-[var(--p-dim2)]'
      }`}
    >
      Save changes
    </button>
  )
}

/** A shared section head: title, one line under it, and the save button in the
 *  top-right corner - the style and terminal tabs read the same. */
function ThemeHead({ sub, save }: { sub: string; save: ReactNode }): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-[12.5px] font-semibold text-[var(--p-text)]">Theme</div>
        <p className="mt-0.5 text-[11.5px] text-[var(--p-dim)]">{sub}</p>
      </div>
      {save}
    </div>
  )
}

function Tile({
  on,
  onClick,
  children
}: {
  on: boolean
  onClick: () => void
  children: ReactNode
}): JSX.Element {
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
    <span
      className={`text-[12.5px] font-semibold ${on ? 'text-[var(--p-text)]' : 'text-[var(--p-text-soft)]'}`}
    >
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

function PlayerTab({
  transportStyle,
  onPickTransport
}: {
  transportStyle: TransportStyle
  onPickTransport: (s: TransportStyle) => void
}): JSX.Element {
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


const CORNER_OPTIONS: Array<{ id: Style['corners']; name: string }> = [
  { id: '2', name: 'Square' },
  { id: '8', name: 'Soft' },
  { id: '14', name: 'Round' }
]

const EDGE_OPTIONS: Array<{ id: Style['borders']; name: string }> = [
  { id: 'none', name: 'None' },
  { id: 'faint', name: 'Faint' },
  { id: 'hairline', name: 'Hairline' },
  { id: 'strong', name: 'Strong' }
]

const FONT_OPTIONS: Array<{ id: FontId; name: string }> = (Object.keys(FONTS) as FontId[]).map(
  (id) => ({ id, name: FONTS[id].name })
)

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
  // Ask the store rather than re-deriving it here: this list had already fallen
  // behind twice, and a Save button that misses an edit loses it.
  const dirty = isEdited()
  void edits // re-render when an edit lands, so `dirty` is read again
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

      <ThemeHead
        sub="Pick a style; the controls below edit the one you are on."
        save={<SaveButton dirty={dirty} onClick={savePreset} title="Keep this edit as a preset" />}
      />

      {/* Once a colour is changed nothing here is selected: what is on screen is
          no longer any of these. Clicking one is how you go back to it. */}
      <div className={GRID}>
        {list.map((st) => {
          // The CURRENT style's card is live: it renders the edited style, so
          // turning Void white turns its card white with it. It also stays
          // selected through an edit - the user reads it as "my theme", and a
          // wall with nothing selected read as a bug. Clicking it while edited
          // does nothing (setStyle would silently revert the edits); every
          // other card still shows its saved self and gives what it shows.
          const live = st.id === style.id
          const on = st.id === (selected ?? style.id)
          return (
            <Tile
              key={st.id}
              on={on}
              onClick={() => {
                if (live && selected === null) return
                setStyle(st.id)
              }}
            >
              <StyleMini st={live ? style : st} />
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
                    <svg
                      viewBox="0 0 24 24"
                      width={13}
                      height={13}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      aria-hidden
                    >
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                )}
              </div>
            </Tile>
          )
        })}
      </div>

      {/* The save button lives in the ThemeHead above, where the terminal tab
          also keeps its own - the two tabs read the same. */}
      <Section title="This style">
        <div className={ROWS}>
          <Pref id="c-font" label="Font" hint="The typeface the app sets in.">
            <Select
              id="c-font"
              value={style.font}
              onChange={(v) => setOverride('font', v)}
              options={FONT_OPTIONS}
            />
          </Pref>
          <Pref id="c-edges" label="Edges" hint="Hairlines between the chrome and the window.">
            <Segmented
              value={style.borders}
              onChange={(v) => setOverride('borders', v)}
              options={EDGE_OPTIONS}
            />
          </Pref>
          {/* Every style takes frost (owner decision, 2026-08-08): above zero
              the override turns the material to acrylic, at zero it is solid,
              so the slider does something honest wherever it starts. */}
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
              <span className="w-[34px] text-right font-mono text-[11.5px] text-[var(--p-dim)]">
                {glass}%
              </span>
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
          {/* No Panel picker: the window is deliberately ONE surface - the
              sidebar and title bar derive from Background (variablesFor), so a
              separate panel colour would be a control that does nothing. */}
          <Pref id="c-corners" label="Corners" hint="How round the window's larger surfaces are.">
            <Segmented
              value={style.corners}
              onChange={(v) => setOverride('corners', v)}
              options={CORNER_OPTIONS}
            />
          </Pref>
          <Pref id="c-folder-icon" label="Folder icons" hint="The folder rows in the tree.">
            <ColourWell
              id="c-folder-icon"
              value={folderIconOf(style)}
              custom={!!edits.folderIcon}
              onChange={(v) => setOverride('folderIcon', v)}
              onReset={() => setOverride('folderIcon', null)}
            />
          </Pref>
          <Pref
            id="c-file-icon"
            label="File icons"
            hint="One colour for every file icon; the kind shows in the shape."
          >
            <ColourWell
              id="c-file-icon"
              value={fileIconOf(style)}
              custom={!!edits.fileIcon}
              onChange={(v) => setOverride('fileIcon', v)}
              onReset={() => setOverride('fileIcon', null)}
            />
          </Pref>
        </div>
        <div className="mt-4 flex items-center justify-between gap-6">
          <div>
            <div className="text-[12.5px] font-semibold text-[var(--p-text)]">Accent</div>
            <p className="text-[11.5px] text-[var(--p-dim)]">
              Selection, progress bar and visualizer.
            </p>
          </div>
          {/* One picker, like Background and Text: the accent is a colour you
              choose, not a scheme you browse. (The swatch grid lived here
              until 2026-08-21.) */}
          <ColourWell
            id="c-accent"
            value={paletteOf(style.accent)[0]}
            custom={!!edits.accent}
            onChange={(v) => setOverride('accent', v)}
            onReset={() => setOverride('accent', null)}
          />
        </div>
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
function Pref({
  id,
  label,
  hint,
  children
}: {
  id: string
  label: string
  hint?: string
  children: ReactNode
}): JSX.Element {
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
      className="h-8 min-w-[168px] rounded-lg border border-[color:var(--p-line)] bg-[var(--p-control)] px-2.5 text-[12px] font-medium text-[var(--p-text)] transition-colors hover:border-[color:var(--p-divider)] focus-visible:border-[var(--p-accent-hi)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--p-accent)]/45"
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  )
}

/** A theme as a miniature terminal: prompt, coloured ls output, cursor. The
 *  point is the SYNTAX colours - a swatch row says nothing about how a real
 *  session will read. The follow-style card paints itself with the live CSS
 *  variables, so it always shows what following the style currently means. */
function TermThemeCard({
  id,
  name,
  on,
  bg,
  fg,
  cursor,
  ansi,
  onPick,
  onEdit
}: {
  id: string
  name: string
  on: boolean
  bg: string
  fg: string
  cursor: string
  ansi: { green: string; yellow: string; blue: string; cyan: string; red: string }
  onPick: () => void
  /** Rendered as a pencil on the SELECTED card only. */
  onEdit?: () => void
}): JSX.Element {
  return (
    <button
      data-term-card={id}
      aria-pressed={on}
      onClick={onPick}
      className={`group flex w-[196px] flex-col overflow-hidden rounded-md border text-left transition-colors ${
        on
          ? 'border-[color:var(--p-accent-hi)] ring-1 ring-[var(--p-accent)]/45'
          : 'border-[color:var(--p-line)] hover:border-[color:var(--p-divider)]'
      }`}
    >
      <div
        className="h-[92px] w-full px-2.5 py-2 font-mono text-[10.5px] leading-[1.5]"
        style={{ background: bg, color: fg }}
      >
        <div>
          <span style={{ color: ansi.green }}>you@pc</span>
          <span style={{ color: fg }}>:</span>
          <span style={{ color: ansi.blue }}>~/app</span>
          <span style={{ color: ansi.red }}>$</span> ls
          <span className="ml-[1px] inline-block h-[11px] w-[6px] translate-y-[2px]" style={{ background: cursor }} />
        </div>
        <div>
          <span style={{ color: ansi.blue }}>src</span>  <span style={{ color: ansi.blue }}>docs</span>{'  '}
          <span style={{ color: ansi.green }}>run.sh</span>
        </div>
        <div>
          <span style={{ color: ansi.yellow }}>notes.md</span>  <span style={{ color: ansi.cyan }}>a.link</span>
        </div>
        <div style={{ color: fg }}>12 files</div>
      </div>
      <div
        className={`flex items-center justify-between border-t px-2.5 py-1.5 text-[11.5px] font-semibold ${
          on ? 'border-[color:var(--p-accent-hi)]/40 text-[var(--p-accent-hi)]' : 'border-[color:var(--p-line)] text-[var(--p-text)]'
        }`}
      >
        <span>{name}</span>
        {/* Only the SELECTED theme wears the pencil: editing starts from what
            you are using, and saving lands in the Custom slot. */}
        {on && onEdit && (
          <span
            role="button"
            tabIndex={0}
            data-edit-theme={id}
            className="grid h-5 w-5 place-items-center rounded text-[var(--p-accent-hi)] hover:bg-white/10"
            title="Edit colours (saves as Custom)"
            aria-label={`Edit ${name}`}
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                onEdit()
              }
            }}
          >
            <svg viewBox="0 0 24 24" width={11} height={11} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 5l4 4L8 20H4v-4z" />
            </svg>
          </span>
        )}
      </div>
    </button>
  )
}

const ANSI_KEYS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'
] as const

/** The Tabby-style editor: every colour of a theme, individually, with the
 *  live preview beside them. Save lands in the single Custom slot. */
function TermThemeEditor({
  seed,
  onSave,
  onCancel
}: {
  seed: CustomTermTheme
  onSave: (t: CustomTermTheme) => void
  onCancel: () => void
}): JSX.Element {
  const [draft, setDraft] = useState<CustomTermTheme>(seed)
  const set = (k: string, v: string): void =>
    setDraft((d) =>
      k === 'bg' || k === 'fg' || k === 'cursor'
        ? { ...d, [k]: v }
        : { ...d, ansi: { ...d.ansi, [k]: v } }
    )
  const well = (label: string, key: string, value: string): JSX.Element => (
    <label key={key} className="flex items-center justify-between gap-2 text-[11px] text-[var(--p-dim)]">
      <span className="w-[86px] truncate">{label}</span>
      <HexSwatch label={label} value={value} onChange={(v) => set(key, v)} />
    </label>
  )
  return (
    // A popup, not an inline section: below the 39-card grid the editor sat
    // out of view. data-owns-escape keeps App's window Escape away; the
    // backdrop and Escape both cancel.
    <div
      data-theme-editor
      data-owns-escape
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 backdrop-blur-[3px]"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onCancel()
        }
      }}
      role="dialog"
      aria-label="Edit terminal colours"
    >
      <div className="max-h-[85vh] overflow-y-auto rounded-lg border border-[color:var(--p-divider)] bg-[var(--p-side-flat)] p-5 shadow-[0_18px_48px_rgba(0,0,0,.55)]">
      <div className="mb-3 text-[13px] font-bold text-[var(--p-text)]">Edit colours</div>
      <div className="flex flex-wrap items-start gap-6">
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
          {well('Background', 'bg', draft.bg)}
          {well('Foreground', 'fg', draft.fg)}
          {well('Cursor', 'cursor', draft.cursor)}
          {ANSI_KEYS.map((k) => well(k, k, draft.ansi[k] ?? '#888888'))}
        </div>
        <TermThemeCard
          id="custom-preview"
          name="Custom"
          on
          bg={draft.bg}
          fg={draft.fg}
          cursor={draft.cursor}
          ansi={{
            green: draft.ansi.green ?? '#8cc265',
            yellow: draft.ansi.yellow ?? '#d1a54b',
            blue: draft.ansi.blue ?? '#4aa5f0',
            cyan: draft.ansi.cyan ?? '#42b3c2',
            red: draft.ansi.red ?? '#e05561'
          }}
          onPick={() => {}}
        />
      </div>
      <div className="mt-4 flex gap-2">
        <button
          className="h-8 rounded-lg bg-[var(--p-accent)] px-4 text-[12px] font-semibold text-[var(--p-on-accent)] hover:brightness-110"
          onClick={() => onSave(draft)}
        >
          Save as Custom
        </button>
        <button
          className="h-8 rounded-lg border border-[color:var(--p-line)] px-4 text-[12px] font-semibold text-[var(--p-text)] transition-colors hover:border-[color:var(--p-divider)]"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
      </div>
    </div>
  )
}

function TerminalTab(): JSX.Element {
  // The shells main detected, fetched when the tab first shows. `saved` may
  // name one that no longer exists; the select then shows the real default,
  // which is also what a new terminal would actually launch.
  const [shells, setShells] = useState<Array<{ id: string; name: string }>>([])
  const [shellChoice, setShellChoice] = useState(() => savedShellId() ?? '')
  useEffect(() => {
    void window.prism.termShells().then(setShells)
  }, [])
  const shellValue = shells.some((sh) => sh.id === shellChoice)
    ? shellChoice
    : (shells[0]?.id ?? '')
  const themeId = useTermThemeId()
  const fontPct = useTermFontPct()
  const fontId = useTermFontId()
  const agentInd = useAgentIndicator()
  const acrylicOn = useTermAcrylic()
  const agentCol = useAgentColor()
  // The follow-style card mirrors the LIVE style, derived ANSI included, and
  // repaints when the style does.
  const [styleTheme, setStyleTheme] = useState(() => readTermTheme())
  useEffect(() => watchTermTheme(() => setStyleTheme(readTermTheme())), [])
  const styleAnsi = deriveAnsi(styleTheme.background, styleTheme.foreground)
  const custom = useCustomTermTheme()
  // Presets ordered by brightness, direction set by the app's mode: on a
  // light style the wall runs light to dark, on a dark one dark to light -
  // the themes nearest your own look lead.
  const appMode = useMode()
  const sortedPresets = useMemo(() => {
    const lum = (bg: string): number => luminance(normalizeColor(bg, '#000000'))
    return [...TERM_PRESETS].sort((a, b) =>
      appMode === 'light' ? lum(b.bg) - lum(a.bg) : lum(a.bg) - lum(b.bg)
    )
  }, [appMode])
  // "Save changes", like the style wall's: the WHOLE terminal setup - palette
  // of the selected theme, font, size, indicator, acrylic - lands in the
  // Custom slot, reselectable after any style switch. Dirty means the current
  // setup differs from what Custom holds (or nothing is saved yet), so the
  // button greys out exactly like the style tab's.
  const buildTermSetup = (): CustomTermTheme => {
    const t = resolveTermTheme(termThemeId())
    const ansi: Record<string, string> = {}
    for (const k of ANSI_KEYS) {
      const v = t[k]
      if (typeof v === 'string') ansi[k] = v
    }
    return {
      bg: normalizeColor(t.background, '#101215'),
      fg: normalizeColor(t.foreground, '#e3e6ea'),
      cursor: normalizeColor(t.cursor, '#5b5bd6'),
      ansi,
      font: fontId,
      fontPct,
      indicator: agentInd,
      indicatorColor: agentCol,
      acrylic: acrylicOn
    }
  }
  // Dirty = the SETTINGS deviate from the selected theme's stock: any theme
  // arrives with the defaults, a Custom arrives with what it saved. Comparing
  // whole palettes kept the button lit forever - the palette IS the selection.
  const extras = { font: fontId, fontPct, indicator: agentInd, indicatorColor: agentCol, acrylic: acrylicOn }
  const baseline =
    themeId === 'custom' && custom
      ? {
          font: custom.font ?? TERM_EXTRA_DEFAULTS.font,
          fontPct: custom.fontPct ?? TERM_EXTRA_DEFAULTS.fontPct,
          indicator: custom.indicator ?? TERM_EXTRA_DEFAULTS.indicator,
          indicatorColor: custom.indicatorColor ?? TERM_EXTRA_DEFAULTS.indicatorColor,
          acrylic: custom.acrylic ?? TERM_EXTRA_DEFAULTS.acrylic
        }
      : TERM_EXTRA_DEFAULTS
  const termDirty = JSON.stringify(extras) !== JSON.stringify(baseline)
  const saveTermSetup = (): void => {
    saveCustomTermTheme(buildTermSetup())
    setTermThemeId('custom')
  }
  // The editor popup, seeded from the SELECTED theme. One Edit button: the
  // per-card pencils read as altering that preset, and presets never change -
  // editing always lands in the Custom slot.
  const [editing, setEditing] = useState<CustomTermTheme | null>(null)
  // Measured at click time, so the expand can ANIMATE: max-height can't
  // tween to 'none', only to a number, and the content's real height is the
  // honest one. 268px is the two collapsed rows.
  const [wallHeight, setWallHeight] = useState(268)
  const allThemes = wallHeight !== 268
  const themeWall = useRef<HTMLDivElement>(null)
  const toggleWall = (): void =>
    setWallHeight(allThemes ? 268 : (themeWall.current?.scrollHeight ?? 2400))
  const editFrom = (id: string): void => {
    const t = resolveTermTheme(id)
    const ansi: Record<string, string> = {}
    for (const k of ANSI_KEYS) {
      const v = t[k]
      if (typeof v === 'string') ansi[k] = v
    }
    // Normalised: an acrylic follow-style publishes rgba(), and a colour
    // input handed rgba() silently renders black.
    setEditing({
      bg: normalizeColor(t.background, '#101215'),
      fg: normalizeColor(t.foreground, '#e3e6ea'),
      cursor: normalizeColor(t.cursor, '#5b5bd6'),
      ansi
    })
  }
  return (
    <div className={ROWS}>
      {shells.length > 0 && (
        <Pref id="term-shell" label="Shell" hint="Applies to new terminals.">
          <Select
            id="term-shell"
            value={shellValue}
            onChange={(v) => {
              setShellChoice(v)
              saveShellId(v)
            }}
            options={shells}
          />
        </Pref>
      )}
      <div className="border-b border-[color:var(--p-line)] py-2.5">
        <ThemeHead
          sub="Follow style wears the app's look; presets are whole palettes, ANSI colours included."
          save={
            <SaveButton
              dirty={termDirty}
              onClick={saveTermSetup}
              title="Keep the whole terminal setup - theme, font, indicator, acrylic - as Custom"
            />
          }
        />
        <div
          ref={themeWall}
          // Ease OPEN only: the transition class is present exactly when the
          // expanded height applies, so collapsing snaps shut instantly.
          className={`relative mt-3 overflow-hidden ${
            allThemes ? 'transition-[max-height] duration-[240ms] [transition-timing-function:cubic-bezier(.16,1,.3,1)]' : ''
          }`}
          // Two card rows by default: 39 themes as one wall buried the font
          // row below them. The snap-open eased in 240ms rather than jumping.
          style={{ maxHeight: wallHeight }}
        >
        <div className="flex flex-wrap gap-3">
          <TermThemeCard
            id="style"
            name="Follow style"
            on={themeId === 'style'}
            bg={styleTheme.background}
            fg={styleTheme.foreground}
            cursor={styleTheme.cursor}
            ansi={styleAnsi}
            onPick={() => {
              setTermThemeId('style')
              resetTermExtras() // the theme is the whole setup
            }}
            onEdit={() => editFrom('style')}
          />
          {custom && (
            <TermThemeCard
              id="custom"
              name="Custom"
              on={themeId === 'custom'}
              bg={custom.bg}
              fg={custom.fg}
              cursor={custom.cursor}
              ansi={{
                green: custom.ansi.green ?? '#8cc265',
                yellow: custom.ansi.yellow ?? '#d1a54b',
                blue: custom.ansi.blue ?? '#4aa5f0',
                cyan: custom.ansi.cyan ?? '#42b3c2',
                red: custom.ansi.red ?? '#e05561'
              }}
              onPick={() => {
                setTermThemeId('custom')
                // The saved setup is more than the palette: font, indicator,
                // acrylic come back with it when the save captured them.
                applyCustomExtras(custom)
              }}
              onEdit={() => editFrom('custom')}
            />
          )}
          {sortedPresets.map((p) => {
            const t = resolveTermTheme(p.id)
            return (
              <TermThemeCard
                key={p.id}
                id={p.id}
                name={p.name}
                on={themeId === p.id}
                bg={t.background}
                fg={t.foreground}
                cursor={t.cursor}
                ansi={{
                  green: t.green ?? '',
                  yellow: t.yellow ?? '',
                  blue: t.blue ?? '',
                  cyan: t.cyan ?? '',
                  red: t.red ?? ''
                }}
                onPick={() => {
                  setTermThemeId(p.id)
                  resetTermExtras() // the theme is the whole setup
                }}
                onEdit={() => editFrom(p.id)}
              />
            )
          })}
        </div>
        </div>
        <div className="mt-2 flex justify-center">
          <button
            aria-expanded={allThemes}
            aria-label={allThemes ? 'Show fewer themes' : `Show all ${TERM_PRESETS.length + (custom ? 2 : 1)} themes`}
            title={allThemes ? 'Show fewer' : 'Show all themes'}
            className="grid h-7 w-10 place-items-center rounded text-[var(--p-icon)] transition-colors hover:bg-white/10 hover:text-[var(--p-text)]"
            onClick={toggleWall}
          >
            <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${allThemes ? 'rotate-180' : ''}`} aria-hidden>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </div>
        {editing && (
          <TermThemeEditor
            seed={editing}
            onSave={(t) => {
              saveCustomTermTheme(t)
              setTermThemeId('custom')
              setEditing(null)
            }}
            onCancel={() => setEditing(null)}
          />
        )}
      </div>
      <Pref
        id="term-acrylic"
        label="Acrylic terminal background"
        hint="Follow-style shares the window's acrylic; off gives the terminal its own solid surface. Preset themes keep their colours either way."
      >
        <Switch on={acrylicOn} onChange={setTermAcrylic} label="Acrylic terminal background" />
      </Pref>
      <Pref
        id="agent-indicator"
        label="Agent indicator"
        hint="How a tab shows Claude or codex working. Idle tabs stay default."
      >
        <Segmented
          value={agentInd}
          onChange={(v) => setAgentIndicator(v as AgentIndicator)}
          options={[
            { id: 'off', name: 'Off' },
            { id: 'minimal', name: 'Minimal' },
            { id: 'full', name: 'Full' }
          ]}
        />
      </Pref>
      <Pref
        id="agent-color"
        label="Indicator colour"
        hint="The fill (full) or the icon and edge bar (minimal) while an agent works."
      >
        <HexSwatch label="Indicator colour" value={agentCol} onChange={setAgentColor} />
      </Pref>
      <Pref id="term-font-family" label="Font" hint="The terminal's typeface. A face you don't have falls back quietly.">
        <Select
          id="term-font-family"
          value={fontId}
          onChange={setTermFontId}
          options={TERM_FONTS.map((f) => ({ id: f.id, name: f.name }))}
        />
      </Pref>
      <Pref
        id="term-font"
        label="Font size"
        hint="The base for every terminal. Ctrl+scroll zooms one session only."
      >
        <Select
          id="term-font"
          value={String(fontPct)}
          onChange={(v) => setTermFontPct(Number(v))}
          options={FONT_PCTS.map((p) => ({ id: String(p), name: `${p}%` }))}
        />
      </Pref>
    </div>
  )
}

function GeneralTab(): JSX.Element {
  const size = useTreeSize()
  const follow = useAutoScroll()
  const confirmClose = useConfirmCloseTabs()
  const tabMode = useNewTabMode()
  const tabFolder = useNewTabFolder()
  const tabShow = useNewTabShow()
  // Picking "A chosen folder" opens the chooser right away; cancelling keeps
  // whatever was set before rather than leaving a mode with no folder.
  const pickTabMode = (v: string): void => {
    if (v === 'folder') {
      void window.prism.pickFolder().then((dir) => {
        if (dir) setNewTabMode('folder', dir)
      })
    } else setNewTabMode(v as 'home' | 'ask')
  }
  const side = useTreeSide()
  return (
    <div className={ROWS}>
      <Pref id="tree-size" label="Font size" hint="Sidebar rows and this page.">
        <Select
          id="tree-size"
          value={size.id}
          onChange={(v) => setTreeSize(v as TreeSize)}
          options={TREE_SIZES}
        />
      </Pref>
      <Pref
        id="auto-scroll"
        label="Auto scroll"
        hint="The sidebar follows the file you are viewing."
      >
        <Switch on={follow} onChange={setAutoScroll} label="Auto scroll" />
      </Pref>
      <Pref
        id="confirm-close"
        label="Ask before closing tabs"
        hint="Ctrl+W and the tab's X confirm first. Unsaved text always asks."
      >
        <Switch on={confirmClose} onChange={setConfirmCloseTabs} label="Ask before closing tabs" />
      </Pref>
      <Pref
        id="newtab-mode"
        label="New tabs open in"
        hint={tabMode === 'folder' && tabFolder ? tabFolder : 'Where the + and Ctrl+T land.'}
      >
        <Select
          id="newtab-mode"
          value={tabMode}
          onChange={pickTabMode}
          options={[
            { id: 'home', name: 'Your user folder' },
            { id: 'folder', name: 'A chosen folder…' },
            { id: 'ask', name: 'Always ask' }
          ]}
        />
      </Pref>
      <Pref id="newtab-show" label="New tabs show" hint="What a fresh tab puts on screen.">
        <Select
          id="newtab-show"
          value={tabShow}
          onChange={(v) => setNewTabShow(v as NewTabShow)}
          options={[
            { id: 'file', name: 'First file in the folder' },
            { id: 'terminal', name: 'A terminal' }
          ]}
        />
      </Pref>
      <Pref id="tree-side" label="Sidebar side" hint="Which edge the file tree sits on.">
        <Segmented value={side} onChange={(v) => setTreeSide(v as TreeSide)} options={TREE_SIDES} />
      </Pref>
      {/* Setup offers this once; this is where you find it afterwards. Windows
          owns the choice, so all we can do is open the page it lives on. */}
      <Pref
        id="default-apps"
        label="Default viewer"
        hint="Windows keeps this choice. Opens Prism's page in Default apps."
      >
        <button
          id="default-apps"
          onClick={() => void window.prism.openDefaultApps()}
          className="h-8 rounded-lg border border-[color:var(--p-accent)]/45 bg-[var(--p-accent)]/10 px-3 text-[12px] font-semibold text-[var(--p-accent-hi)] transition-colors hover:border-[color:var(--p-accent)] hover:bg-[var(--p-accent)]/18 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--p-accent)]/45"
        >
          Choose in Windows
        </button>
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
    <div className="grid grid-cols-[repeat(auto-fill,minmax(56px,1fr))] gap-1.5 [&>*]:max-w-[74px]">
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
function SchemePicker({
  selectedId,
  onPick
}: {
  selectedId: string
  onPick: (id: string) => void
}): JSX.Element {
  // The accent-following scheme leads the list, drawn in the colour it is
  // actually following rather than the placeholder it carries.
  const themes = [resolveVizTheme(ACCENT_THEME_ID), ...visibleThemes()]
  return (
    <div className="flex flex-col gap-3">
      {COLOUR_ORDER.map((cat) => {
        const items = themes.filter((t) => colourCategory(t) === cat)
        if (!items.length) return null
        return (
          <div key={cat}>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[.14em] text-[var(--p-dim2)]">
              {cat}
            </div>
            <Swatches
              items={items.map((t) => ({
                id: t.id,
                name: t.name,
                fill:
                  t.palette.length > 1
                    ? `linear-gradient(90deg, ${t.palette.join(', ')})`
                    : t.palette[0]
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
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[.14em] text-[var(--p-dim2)]">
          Effects
        </div>
        <EffectToggles
          glow={glow}
          cycle={cycle}
          move={move}
          onGlow={onGlow}
          onCycle={onCycle}
          onMove={onMove}
        />
      </div>
    </div>
  )
}

/* ---------- tabs shell ---------- */

type TabId = 'style' | 'general' | 'terminal' | 'player' | 'visualizer' | 'about'

const Ico = ({ d }: { d: string }): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    width={17}
    height={17}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d={d} />
  </svg>
)

const TABS: Array<{ id: TabId; label: string; title: string; icon: ReactNode }> = [
  {
    id: 'style',
    label: 'Style',
    title: 'Style',
    icon: (
      <Ico d="M12 3a9 9 0 1 0 0 18 3 3 0 0 0 0-6 3 3 0 0 1 0-6h3a6 6 0 0 0-3-6ZM7.5 10.5h.01M10 7h.01M14 7h.01" />
    )
  },
  {
    id: 'general',
    label: 'General',
    title: 'General',
    icon: (
      <Ico d="M4 7h8M16 7h4M4 17h4M12 17h8M12 7a2 2 0 1 0 4 0 2 2 0 1 0-4 0M8 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0" />
    )
  },
  {
    id: 'terminal',
    label: 'Terminal',
    title: 'Terminal',
    icon: <Ico d="M4 5h16v14H4zM7.5 9.5l3 2.5-3 2.5M13 15h4" />
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
  { name: 'Behaviour', tabs: ['general', 'terminal'] },
  { name: 'Look', tabs: ['style', 'visualizer', 'player'] },
  { name: '', tabs: ['about'] }
]

export function Settings({
  open,
  onClose,
  compactRail,
  onShowSetup,
  transportStyle,
  onPickTransport
}: {
  open: boolean
  onClose: () => void
  /** The rail collapsed to its icons, from the title-bar button. */
  compactRail: boolean
  /** Run the first-run setup again. */
  onShowSetup: () => void
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
      className="fixed inset-x-0 bottom-0 top-[68px] z-40"
      style={{ fontFamily: FONTS.system.stack, fontSize: '12.5px' }}
    >
      <div className="flex h-full w-full" style={{ zoom: size.zoom }}>
        {/* tab rail, grouped: how Prism behaves, then what it looks like. The same
          title-bar button that hides the file tree collapses this to its glyphs. */}
        <aside
          className={`p-wash flex shrink-0 flex-col overflow-hidden border-r border-[var(--p-divider)] bg-[var(--p-side)] transition-[width] duration-[180ms] [transition-timing-function:cubic-bezier(.23,1,.32,1)] ${
            compactRail ? 'w-[56px] p-2' : 'w-[212px] p-2.5'
          }`}
        >
          <div
            className={`px-2 pb-1 pt-1 text-[14px] font-bold tracking-tight text-[var(--p-text)] ${
              compactRail ? 'invisible' : ''
            }`}
          >
            Settings
          </div>
          {RAIL_GROUPS.map((g) => (
            <nav key={g.name} className="flex flex-col gap-0.5">
              {g.name && !compactRail ? (
                <div className="px-2 pb-1 pt-3 text-[10px] font-bold uppercase tracking-[.14em] text-[var(--p-dim2)]">
                  {g.name}
                </div>
              ) : (
                <div className="pt-3" />
              )}
              {g.tabs.map((id) => {
                const t = TABS.find((x) => x.id === id)
                if (!t) return null
                const on = t.id === tab
                return (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    title={t.label}
                    aria-label={t.label}
                    className={`flex items-center gap-2.5 rounded-[var(--p-radius-sm)] py-[7px] text-left text-[13px] transition ${
                      compactRail ? 'justify-center px-0' : 'px-2.5'
                    } ${
                      on
                        ? 'bg-[var(--p-sel-bg)] font-semibold text-[var(--p-on-accent)]'
                        : 'font-medium text-[var(--p-dim)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]'
                    }`}
                  >
                    <span className={on ? 'opacity-90' : ''}>{t.icon}</span>
                    {!compactRail && t.label}
                  </button>
                )
              })}
            </nav>
          ))}
          <div
            className={`mt-auto px-2 pb-0.5 text-[10.5px] text-[var(--p-dim2)] ${compactRail ? 'invisible' : ''}`}
          >
            Prism
          </div>
        </aside>

        {/* content */}
        <div className="p-wash flex min-w-0 flex-1 flex-col bg-[var(--p-bg)]">
          {/* No close button: the cog that opened this closes it, and Escape works
              too. One control, one place. */}
          <header className="px-6 pb-3 pt-5">
            <h2 className="text-[21px] font-bold leading-none tracking-[-.022em] text-[var(--p-text)]">
              {active.title}
            </h2>
          </header>

          <div className="p-scroll min-h-0 flex-1 overflow-y-auto px-6 py-2">
            {tab === 'style' ? (
              <StyleTab />
            ) : tab === 'general' ? (
              <GeneralTab />
            ) : tab === 'terminal' ? (
              <TerminalTab />
            ) : tab === 'player' ? (
              <PlayerTab transportStyle={transportStyle} onPickTransport={onPickTransport} />
            ) : tab === 'visualizer' ? (
              <VisualizerTab />
            ) : (
              <div className="flex max-w-[46ch] flex-col items-start gap-4">
                <p className="text-[12.5px] leading-relaxed text-[var(--p-dim)]">
                  A quick viewer for images, video, audio and documents.
                </p>
                <button
                  onClick={onShowSetup}
                  className="rounded-[var(--p-radius-sm)] border border-[color:var(--p-line)] px-3.5 py-2 text-[12.5px] font-semibold text-[var(--p-text)] transition hover:border-[color:var(--p-dim2)]"
                >
                  Show setup again
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
