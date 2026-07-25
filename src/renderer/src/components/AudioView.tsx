import { useCallback, useEffect, useRef, useState, type JSX, type SyntheticEvent } from 'react'
import { useMediaControls } from '../lib/useMediaControls'
import { Transport } from './Transport'
import { Visualizer } from './Visualizer'
import {
  DEFAULT_STYLE_ID,
  THEMES,
  DEFAULT_THEME_ID,
  themeById,
  DROP_VARIANTS,
  DEFAULT_DROP_STYLE
} from '../lib/viz/styles'

// The bar SHAPE comes from the preset (settled). The COLOUR is a separate axis:
// the list is a colour picker, applied on top of whatever shape is showing.

// The audio player: the chosen visualizer fills the window, with a gear menu for
// picking a style and shaping how it sits. The filename stays in the title bar
// rather than on the glass. The <audio> element is hidden and crossorigin so the
// visualizer's AnalyserNode can read its samples (see fsmedia in main).

const STYLE_KEY = 'prism.viz.style'
const THEME_KEY = 'prism.viz.theme'
const WIDTH_KEY = 'prism.viz.width'
const LOGO_KEY = 'prism.viz.logo'
const HEIGHT_KEY = 'prism.viz.height'
const POS_KEY = 'prism.viz.pos'
const DROP_KEY = 'prism.viz.drop'

// Some styles read better spanning the glass, others want to sit in a band.
const WIDTHS: Record<string, string> = {
  full: 'w-full',
  wide: 'w-full max-w-5xl',
  compact: 'w-full max-w-2xl'
}
const WIDTH_LABELS: Array<[string, string]> = [
  ['full', 'Full'],
  ['wide', 'Wide'],
  ['compact', 'Compact']
]

// Curated looks: a style plus the framing that suits it. Picking one sets every
// control at once, and the controls stay free afterwards.
//
// These ship as the starting set, but the list is editable at runtime and kept
// in localStorage, so the shipping selection can be authored in the app itself.
// "Copy JSON" in the menu exports whatever you end up with.
interface Preset {
  id: string
  name: string
  style: string
  height: number
  pos: number
  width: string
  logo: boolean
  /** Colour theme; older presets without it fall back to Brand. */
  theme?: string
}
const PRESETS_KEY = 'prism.viz.presets'
const PRESETS_SEED_KEY = 'prism.viz.presetsSeed'
// Bump when DEFAULT_PRESETS changes and the new set should replace what users
// (and this dev box) already have stored. End users only ever seed once.
const PRESETS_SEED = 8

// With the visualizer filling the whole viewer, pos 50 is genuinely the nav-line
// centre, so mirrored/centred styles all sit at 50. The two grounded styles sit
// low on purpose (bars rise from the transport). Halo is trimmed a little so the
// ring clears the transport overlay at the bottom.
const DEFAULT_PRESETS: Preset[] = [
  { id: 'halo', name: 'Halo', style: 'ripples', height: 88, pos: 50, width: 'full', logo: false, theme: 'glow' },
  { id: 'flow', name: 'Flow', style: 'liquid', height: 95, pos: 50, width: 'full', logo: false },
  { id: 'outline', name: 'Outline', style: 'outline-bars', height: 53, pos: 73, width: 'full', logo: false },
  { id: 'caps', name: 'Caps', style: 'mirror-caps', height: 41, pos: 50, width: 'full', logo: false },
  { id: 'frame', name: 'Frame', style: 'mirror-outline', height: 44, pos: 50, width: 'full', logo: false },
  { id: 'wall', name: 'Wall', style: 'clean-wall', height: 56, pos: 72, width: 'full', logo: false },
  { id: 'linebars', name: 'Line Bars', style: 'needles', height: 44, pos: 50, width: 'full', logo: false },
  { id: 'mirrorbars', name: 'Mirror Bars', style: 'chrome-bars', height: 51, pos: 50, width: 'full', logo: false },
  { id: 'bars', name: 'Bars', style: 'solid-bars', height: 53, pos: 73, width: 'full', logo: false },
  { id: 'wall2', name: 'Wall 2', style: 'segments', height: 56, pos: 72, width: 'full', logo: false },
  { id: 'barscircle', name: 'Round', style: 'outline-round', height: 56, pos: 72, width: 'full', logo: false },
  { id: 'barscirclefull', name: 'Round Solid', style: 'solid-round', height: 56, pos: 72, width: 'full', logo: false }
]

function Logo(): JSX.Element {
  return (
    <div className="grid h-28 w-28 shrink-0 place-items-center rounded-3xl bg-gradient-to-br from-[#5b5bd6] via-[#9a6cff] to-[#ff9a8b] text-5xl text-white shadow-[0_12px_40px_rgba(120,90,255,0.35)]">
      ♪
    </div>
  )
}

function num(key: string, fallback: number): number {
  const v = Number(localStorage.getItem(key))
  return Number.isFinite(v) && v > 0 ? v : fallback
}

// Themes the user has hidden from the picker while curating. Persisted so I can
// read the list back and delete those from the code.
const REMOVED_KEY = 'prism.viz.removedThemes'
function loadRemoved(): Set<string> {
  try {
    const raw = localStorage.getItem(REMOVED_KEY)
    if (raw) {
      // Keep only ids that still exist; once a removal has been baked into the
      // code the theme is gone, so drop it from the set rather than showing a
      // stale count.
      const live = new Set(THEMES.map((t) => t.id))
      const kept = (JSON.parse(raw) as string[]).filter((id) => live.has(id))
      localStorage.setItem(REMOVED_KEY, JSON.stringify(kept))
      return new Set(kept)
    }
  } catch {
    /* ignore */
  }
  return new Set()
}

function loadPresets(): Preset[] {
  // A newer seed replaces whatever is stored, so an updated shipped set actually
  // reaches people who already have an older one saved.
  if (Number(localStorage.getItem(PRESETS_SEED_KEY)) !== PRESETS_SEED) {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(DEFAULT_PRESETS))
    localStorage.setItem(PRESETS_SEED_KEY, String(PRESETS_SEED))
    return DEFAULT_PRESETS
  }
  try {
    const raw = localStorage.getItem(PRESETS_KEY)
    if (!raw) return DEFAULT_PRESETS
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.every((p) => p && p.id && p.name && p.style)) return parsed
  } catch {
    /* corrupt or hand-edited; fall back to the shipped set */
  }
  return DEFAULT_PRESETS
}

// Some MP3s report duration Infinity until a seek forces Chromium to compute it,
// which leaves the scrubber stuck; nudge to the end and back once on load.
function forceDuration(e: SyntheticEvent<HTMLMediaElement>): void {
  const m = e.currentTarget
  if (m.duration === Infinity || Number.isNaN(m.duration)) {
    const onT = (): void => {
      m.removeEventListener('timeupdate', onT)
      m.currentTime = 0
    }
    m.addEventListener('timeupdate', onT)
    try {
      m.currentTime = 1e101
    } catch {
      /* seek not ready yet; ignore */
    }
  }
}

export function AudioView({ url, name }: { url: string; name: string }): JSX.Element {
  // A callback ref feeds both the controls hook (via the ref object) and the
  // visualizer (via state, so it re-renders once the element actually mounts).
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [mediaEl, setMediaEl] = useState<HTMLAudioElement | null>(null)
  const setMedia = (el: HTMLAudioElement | null): void => {
    audioRef.current = el
    setMediaEl(el)
  }
  const c = useMediaControls(audioRef, {
    errorMsg: `“${name}” can’t be played (unsupported codec or corrupt file).`
  })

  const [styleId, setStyleId] = useState<string>(
    () => localStorage.getItem(STYLE_KEY) || DEFAULT_STYLE_ID
  )
  const [themeId, setThemeId] = useState<string>(
    () => localStorage.getItem(THEME_KEY) || DEFAULT_THEME_ID
  )
  const applyTheme = useCallback((id: string) => {
    setThemeId(id)
    localStorage.setItem(THEME_KEY, id)
  }, [])

  // Curation: hide themes from the picker; the list is kept so I can trim the code.
  const [removed, setRemoved] = useState<Set<string>>(loadRemoved)
  const visibleThemes = THEMES.filter((t) => !removed.has(t.id))
  const removeTheme = (id: string): void => {
    setRemoved((prev) => {
      const next = new Set(prev).add(id)
      localStorage.setItem(REMOVED_KEY, JSON.stringify([...next]))
      console.log('[removed themes]', [...next].join(', '))
      return next
    })
    // If we just hid the active theme, jump to the next surviving one.
    if (id === themeId) {
      const next = THEMES.find((t) => t.id !== id && !removed.has(t.id))
      if (next) applyTheme(next.id)
    }
  }
  const restoreThemes = (): void => {
    localStorage.removeItem(REMOVED_KEY)
    setRemoved(new Set())
  }
  const copyRemoved = (): void => {
    void navigator.clipboard.writeText([...removed].join(', '))
  }
  const [width, setWidth] = useState<string>(() => localStorage.getItem(WIDTH_KEY) || 'full')
  const [logo, setLogo] = useState<boolean>(() => localStorage.getItem(LOGO_KEY) === '1')
  const [height, setHeight] = useState<number>(() => num(HEIGHT_KEY, 88)) // % of the stage
  const [pos, setPos] = useState<number>(() => num(POS_KEY, 50)) // % from the top
  const [dropStyle, setDropStyle] = useState<number>(() => num(DROP_KEY, DEFAULT_DROP_STYLE))
  const [previewBurst, setPreviewBurst] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  const applyStyle = useCallback((id: string) => {
    setStyleId(id)
    localStorage.setItem(STYLE_KEY, id)
  }, [])
  const setNum = (key: string, set: (n: number) => void) => (v: number) => {
    set(v)
    localStorage.setItem(key, String(v))
  }
  const pickWidth = (w: string): void => {
    setWidth(w)
    localStorage.setItem(WIDTH_KEY, w)
  }
  const pickDrop = (n: number): void => {
    setDropStyle(n)
    localStorage.setItem(DROP_KEY, String(n))
    // fire a one-off preview so the effect plays the moment its button is clicked
    setPreviewBurst((x) => x + 1)
  }
  const toggleLogo = (): void => {
    setLogo((x) => {
      localStorage.setItem(LOGO_KEY, x ? '0' : '1')
      return !x
    })
  }
  const [presets, setPresets] = useState<Preset[]>(loadPresets)
  const [presetName, setPresetName] = useState('')
  const savePresets = (list: Preset[]): void => {
    setPresets(list)
    localStorage.setItem(PRESETS_KEY, JSON.stringify(list))
  }
  /** Save the current settings under `presetName`. An existing name is
   *  overwritten in place, keeping its position in the row. */
  const saveCurrent = (): void => {
    const name = presetName.trim()
    if (!name) return
    const entry: Preset = {
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name,
      style: styleId,
      height,
      pos,
      width,
      logo,
      theme: themeId
    }
    const i = presets.findIndex((p) => p.name.toLowerCase() === name.toLowerCase())
    if (i >= 0) {
      const next = presets.slice()
      next[i] = { ...entry, id: presets[i].id }
      savePresets(next)
    } else {
      savePresets([...presets, entry])
    }
    setPresetName('')
  }
  const deletePreset = (id: string): void => savePresets(presets.filter((p) => p.id !== id))
  const copyPresets = (): void => {
    void navigator.clipboard.writeText(JSON.stringify(presets, null, 2))
  }
  const resetPresets = (): void => {
    localStorage.removeItem(PRESETS_KEY)
    setPresets(DEFAULT_PRESETS)
  }

  const applyPreset = (p: Preset): void => {
    applyStyle(p.style)
    applyTheme(p.theme ?? DEFAULT_THEME_ID)
    setHeight(p.height)
    localStorage.setItem(HEIGHT_KEY, String(p.height))
    setPos(p.pos)
    localStorage.setItem(POS_KEY, String(p.pos))
    setWidth(p.width)
    localStorage.setItem(WIDTH_KEY, p.width)
    setLogo(p.logo)
    localStorage.setItem(LOGO_KEY, p.logo ? '1' : '0')
  }
  const activePreset = presets.find(
    (p) =>
      p.style === styleId &&
      p.height === height &&
      p.pos === pos &&
      p.width === width &&
      p.logo === logo &&
      (p.theme ?? DEFAULT_THEME_ID) === themeId
  )
  // Typing over a saved name means "save over that one".
  const overwriting = presets.find((p) => p.name.toLowerCase() === presetName.trim().toLowerCase())

  // Click-away and Escape close the menu.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement).closest('[data-viz-menu]')) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  // While the menu is open the arrow keys walk the colour list and apply each one
  // as you go, so themes can be compared quickly. Capture phase + stopPropagation
  // keeps the media hook from also treating them as volume.
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      // This runs in the capture phase, so it would otherwise steal the arrows
      // from the preset name field.
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      e.preventDefault()
      e.stopPropagation()
      const list = visibleThemes.length ? visibleThemes : THEMES
      const i = list.findIndex((t) => t.id === themeId)
      const step = e.key === 'ArrowDown' ? 1 : -1
      const next = list[(i + step + list.length) % list.length]
      applyTheme(next.id)
      listRef.current
        ?.querySelector(`[data-style="${next.id}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [menuOpen, themeId, applyTheme, visibleThemes])

  const slider = (
    label: string,
    value: number,
    min: number,
    max: number,
    onChange: (n: number) => void,
    suffix = '%'
  ): JSX.Element => (
    <div className="px-2.5 py-1.5">
      <div className="mb-1 flex justify-between text-[11px] text-[var(--color-dim)]">
        <span>{label}</span>
        <span className="tabular-nums">
          {Math.round(value)}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer accent-[var(--color-accent-hi)]"
      />
    </div>
  )

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0d0f14]">
      <audio
        ref={setMedia}
        src={url}
        crossOrigin="anonymous"
        autoPlay
        className="hidden"
        onLoadedMetadata={forceDuration}
        {...c.bind}
      />

      {c.error ? (
        <div className="absolute inset-0 grid place-items-center p-8 text-center text-sm text-[#c9ccd6]">
          {c.error}
        </div>
      ) : (
        <>
          {/* The visualizer fills the whole viewer, the same box the nav arrows
              centre in, so vertical position 50 lands exactly on the nav-button
              line at any window size. Height and position size and place the
              canvas itself, so no style code has to know about them. The
              transport (below) overlays the bottom edge. */}
          <div
            className="absolute left-1/2"
            style={{
              width: '100%',
              height: `${height}%`,
              top: `${pos}%`,
              transform: 'translate(-50%, -50%)'
            }}
          >
            <div className={`mx-auto h-full ${WIDTHS[width] ?? WIDTHS.full}`}>
              <Visualizer
                media={mediaEl}
                styleId={styleId}
                theme={themeById(themeId)}
                dropStyle={dropStyle}
                previewBurst={previewBurst}
              />
            </div>
          </div>

          {logo && (
            <div className="pointer-events-none absolute inset-x-0 top-[15%] flex justify-center">
              <Logo />
            </div>
          )}

          {/* settings gear */}
          <div data-viz-menu className="absolute right-3 top-3 z-20">
            <button
              onClick={() => setMenuOpen((x) => !x)}
              title="Visualizer settings"
              aria-label="Visualizer settings"
              aria-expanded={menuOpen}
              className="grid h-9 w-9 place-items-center rounded-full text-[var(--color-dim)] transition hover:bg-white/10 hover:text-white"
            >
              <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <circle cx="12" cy="12" r="3.2" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.35.4.64.73.83H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
              </svg>
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-2 flex max-h-[76vh] w-64 flex-col rounded-xl border border-white/10 bg-[#171a23] shadow-2xl">
                <div className="flex items-baseline justify-between px-3 pb-1.5 pt-2.5">
                  <span className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--color-dim)]">
                    Presets
                  </span>
                  <span className="flex gap-2.5 text-[10px]">
                    <button onClick={copyPresets} className="text-[var(--color-dim)] hover:text-white" title="Copy the whole list as JSON">
                      Copy JSON
                    </button>
                    <button onClick={resetPresets} className="text-[var(--color-dim)] hover:text-white" title="Restore the shipped set">
                      Reset
                    </button>
                  </span>
                </div>

                <div className="flex flex-wrap gap-1 px-1.5 pb-1.5">
                  {presets.map((p) => (
                    <span key={p.id} className="group/chip relative">
                      <button
                        onClick={() => applyPreset(p)}
                        onDoubleClick={() => setPresetName(p.name)}
                        title="Click to apply, double-click to load the name for saving over"
                        className={`rounded-lg py-1.5 pl-2.5 pr-5 text-[11.5px] font-semibold transition hover:bg-white/[.07] ${
                          activePreset?.id === p.id
                            ? 'bg-[var(--color-accent)]/25 text-white'
                            : 'text-[var(--color-dim)]'
                        }`}
                      >
                        {p.name}
                      </button>
                      <button
                        onClick={() => deletePreset(p.id)}
                        title={`Delete “${p.name}”`}
                        aria-label={`Delete ${p.name}`}
                        className="absolute right-0.5 top-1/2 hidden h-4 w-4 -translate-y-1/2 place-items-center rounded text-[11px] leading-none text-[var(--color-dim)] hover:bg-red-500/25 hover:text-red-200 group-hover/chip:grid"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>

                <div className="flex gap-1 px-1.5 pb-2">
                  <input
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveCurrent()
                      e.stopPropagation() // let the field take arrows and space
                    }}
                    placeholder="Name these settings…"
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-[11.5px] text-[#e9ecf5] outline-none placeholder:text-[var(--color-dim)] focus:border-[var(--color-accent)]"
                  />
                  <button
                    onClick={saveCurrent}
                    disabled={!presetName.trim()}
                    className="rounded-lg bg-[var(--color-accent)]/30 px-2.5 py-1.5 text-[11.5px] font-semibold text-white transition hover:bg-[var(--color-accent)]/50 disabled:opacity-35"
                  >
                    {overwriting ? 'Overwrite' : 'Save'}
                  </button>
                </div>

                <div className="flex items-baseline justify-between border-t border-white/10 px-3 pb-1 pt-2">
                  <span className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--color-dim)]">
                    Colour · {visibleThemes.length}
                  </span>
                  <span className="flex items-baseline gap-2.5 text-[10px] text-[var(--color-dim)]">
                    {removed.size > 0 && (
                      <>
                        <button onClick={copyRemoved} className="hover:text-white" title="Copy the removed names">
                          Copy cut ({removed.size})
                        </button>
                        <button onClick={restoreThemes} className="hover:text-white" title="Bring them all back">
                          Restore
                        </button>
                      </>
                    )}
                    <span>↑ ↓ to browse</span>
                  </span>
                </div>

                <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-1.5">
                  {visibleThemes.map((t) => (
                    <div key={t.id} className="group/theme relative">
                      <button
                        data-style={t.id}
                        onClick={() => applyTheme(t.id)}
                        className={`flex w-full items-center gap-2.5 rounded-lg py-2 pl-2.5 pr-8 text-left transition hover:bg-white/[.07] ${
                          t.id === themeId ? 'bg-[var(--color-accent)]/25' : ''
                        }`}
                      >
                        <span
                          className="h-5 w-5 shrink-0 rounded-full"
                          style={{ background: `linear-gradient(135deg, ${t.palette[0]}, ${t.palette[t.palette.length - 1]})` }}
                        />
                        <span className="min-w-0">
                          <span className="block text-[13px] font-semibold text-[#e9ecf5]">{t.name}</span>
                          <span className="mt-0.5 block truncate text-[11px] leading-snug text-[var(--color-dim)]">
                            {t.blurb}
                          </span>
                        </span>
                      </button>
                      <button
                        onClick={() => removeTheme(t.id)}
                        title={`Remove “${t.name}” from the list`}
                        aria-label={`Remove ${t.name}`}
                        className="absolute right-1.5 top-1/2 hidden h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-[15px] leading-none text-[var(--color-dim)] hover:bg-red-500/25 hover:text-red-200 group-hover/theme:grid"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>

                <div className="shrink-0 border-t border-white/10 pb-1.5">
                  {slider('Height', height, 12, 100, setNum(HEIGHT_KEY, setHeight))}
                  {slider('Vertical position', pos, 0, 100, setNum(POS_KEY, setPos))}
                  <div className="px-2.5 pb-1 pt-1 text-[11px] text-[var(--color-dim)]">Width</div>
                  <div className="flex gap-1 px-1.5">
                    {WIDTH_LABELS.map(([w, label]) => (
                      <button
                        key={w}
                        onClick={() => pickWidth(w)}
                        className={`flex-1 rounded-lg px-2 py-1.5 text-[11.5px] font-semibold transition hover:bg-white/[.07] ${
                          w === width ? 'bg-[var(--color-accent)]/25 text-white' : 'text-[var(--color-dim)]'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                    <button
                      onClick={toggleLogo}
                      className={`flex-1 rounded-lg px-2 py-1.5 text-[11.5px] font-semibold transition hover:bg-white/[.07] ${
                        logo ? 'bg-[var(--color-accent)]/25 text-white' : 'text-[var(--color-dim)]'
                      }`}
                    >
                      Artwork
                    </button>
                  </div>
                  <div className="px-2.5 pb-1 pt-2 text-[11px] text-[var(--color-dim)]">
                    Drop effect
                  </div>
                  <div className="grid grid-cols-11 gap-1 px-1.5">
                    {Array.from({ length: DROP_VARIANTS }, (_, i) => i + 1).map((n) => (
                      <button
                        key={n}
                        onClick={() => pickDrop(n)}
                        title={`Drop variant ${n}`}
                        className={`rounded-lg py-1.5 text-[11.5px] font-semibold transition hover:bg-white/[.07] ${
                          n === dropStyle ? 'bg-[var(--color-accent)]/25 text-white' : 'text-[var(--color-dim)]'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* transport overlays the bottom edge of the visualizer */}
          <div className="absolute inset-x-0 bottom-0 z-10 border-t border-white/[.06] bg-[#12141b] px-4 py-3">
            <Transport c={c} />
          </div>
        </>
      )}
    </div>
  )
}
