import { useCallback, useEffect, useRef, useState, type CSSProperties, type JSX, type SyntheticEvent } from 'react'
import { useMediaControls } from '../lib/useMediaControls'
import { Transport } from './Transport'
import { Visualizer } from './Visualizer'
import { useWaveform } from '../lib/useWaveform'
import type { TransportStyle } from '../lib/transport'
import { THEMES, themeById, DROP_VARIANTS, DEFAULT_THEME_ID } from '../lib/viz/styles'
import {
  useViz,
  visibleThemes as visibleThemesOf,
  WIDTHS,
  WIDTH_LABELS,
  barCss,
  setTheme,
  setHeight,
  setPos,
  setWidth,
  setLogo,
  setDrop,
  firePreview,
  applyPreset,
  savePreset,
  deletePreset,
  resetPresets,
  removeTheme,
  restoreThemes,
  type Preset
} from '../lib/vizStore'

// The audio player: the chosen visualizer fills the window, with a gear menu for
// picking a style and shaping how it sits. All the style state lives in the shared
// vizStore, so this gear panel and the app Settings window stay in sync. The
// filename stays in the title bar rather than on the glass. The <audio> element is
// hidden and crossorigin so the visualizer's AnalyserNode can read its samples.

function Logo(): JSX.Element {
  return (
    <div className="grid h-28 w-28 shrink-0 place-items-center rounded-3xl bg-gradient-to-br from-[#5b5bd6] via-[#9a6cff] to-[#ff9a8b] text-5xl text-white shadow-[0_12px_40px_rgba(120,90,255,0.35)]">
      ♪
    </div>
  )
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

export function AudioView({
  url,
  name,
  fullscreen,
  onToggleFullscreen,
  transportStyle
}: {
  url: string
  name: string
  fullscreen: boolean
  onToggleFullscreen: () => void
  transportStyle: TransportStyle
}): JSX.Element {
  const v = useViz()
  const peaks = useWaveform(url, transportStyle === 'wave' || transportStyle === 'wavebold')
  const transportBg = transportStyle !== 'edge' && transportStyle !== 'outline' && transportStyle !== 'island'
  const bar = barCss(v.bar)
  // A callback ref feeds both the controls hook (via the ref object) and the
  // visualizer (via state, so it re-renders once the element actually mounts).
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [mediaEl, setMediaEl] = useState<HTMLAudioElement | null>(null)
  const setMedia = (el: HTMLAudioElement | null): void => {
    audioRef.current = el
    setMediaEl(el)
  }

  // In fullscreen the transport + gear auto-hide like a video player: they slide
  // away after a moment of no mouse movement and return on the next move. In
  // windowed mode they stay put.
  const [chromeOn, setChromeOn] = useState(true)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showChrome = useCallback(() => {
    setChromeOn(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    if (fullscreen) hideTimer.current = setTimeout(() => setChromeOn(false), 2600)
  }, [fullscreen])

  const c = useMediaControls(audioRef, {
    onFullscreen: onToggleFullscreen,
    onActivity: showChrome,
    errorMsg: `“${name}” can’t be played (unsupported codec or corrupt file).`
  })

  // Curation UI state that stays local to this panel.
  const [menuOpen, setMenuOpen] = useState(false)
  const [presetName, setPresetName] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const themes = visibleThemesOf()
  const removedCount = v.removed.length

  // Entering fullscreen (with the menu closed) arms the auto-hide; leaving it, or
  // opening the menu, clears the timer. Chrome is always shown windowed or with
  // the menu open (see chromeVisible below), so the effect never setStates.
  useEffect(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    if (fullscreen && !menuOpen) {
      hideTimer.current = setTimeout(() => setChromeOn(false), 2600)
    }
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [fullscreen, menuOpen])
  const chromeVisible = !fullscreen || menuOpen || chromeOn

  const pickDrop = (n: number): void => {
    setDrop(n)
    firePreview() // play the effect once, the moment its button is clicked
  }
  const saveCurrent = (): void => {
    savePreset(presetName)
    setPresetName('')
  }

  const activePreset = v.presets.find(
    (p) =>
      p.style === v.style &&
      p.height === v.height &&
      p.pos === v.pos &&
      p.width === v.width &&
      p.logo === v.logo &&
      (p.theme ?? DEFAULT_THEME_ID) === v.theme
  )
  // Typing over a saved name means "save over that one".
  const overwriting = v.presets.find((p) => p.name.toLowerCase() === presetName.trim().toLowerCase())

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
      const list = themes.length ? themes : THEMES
      const i = list.findIndex((t) => t.id === v.theme)
      const step = e.key === 'ArrowDown' ? 1 : -1
      const next = list[(i + step + list.length) % list.length]
      setTheme(next.id)
      listRef.current
        ?.querySelector(`[data-style="${next.id}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [menuOpen, v.theme, themes])

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
    <div
      className="relative h-full w-full overflow-hidden bg-[#0d0f14]"
      onMouseMove={showChrome}
      style={{ cursor: chromeVisible ? undefined : 'none' }}
    >
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
              height: `${v.height}%`,
              top: `${v.pos}%`,
              transform: 'translate(-50%, -50%)'
            }}
          >
            <div className={`mx-auto h-full ${WIDTHS[v.width] ?? WIDTHS.full}`}>
              <Visualizer
                media={mediaEl}
                styleId={v.style}
                theme={themeById(v.theme)}
                dropStyle={v.drop}
                previewBurst={v.preview}
                glow={v.glow}
                cycle={v.cycle}
                move={v.move}
              />
            </div>
          </div>

          {v.logo && (
            <div className="pointer-events-none absolute inset-x-0 top-[15%] flex justify-center">
              <Logo />
            </div>
          )}

          {/* settings gear (fades with the chrome in fullscreen) */}
          <div
            data-viz-menu
            className={`absolute right-3 top-3 z-20 transition-opacity duration-300 ${
              chromeVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          >
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
                    <button
                      onClick={() => void navigator.clipboard.writeText(JSON.stringify(v.presets, null, 2))}
                      className="text-[var(--color-dim)] hover:text-white"
                      title="Copy the whole list as JSON"
                    >
                      Copy JSON
                    </button>
                    <button onClick={resetPresets} className="text-[var(--color-dim)] hover:text-white" title="Restore the shipped set">
                      Reset
                    </button>
                  </span>
                </div>

                <div className="flex flex-wrap gap-1 px-1.5 pb-1.5">
                  {v.presets.map((p: Preset) => (
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
                    Colour · {themes.length}
                  </span>
                  <span className="flex items-baseline gap-2.5 text-[10px] text-[var(--color-dim)]">
                    {removedCount > 0 && (
                      <>
                        <button
                          onClick={() => void navigator.clipboard.writeText(v.removed.join(', '))}
                          className="hover:text-white"
                          title="Copy the removed names"
                        >
                          Copy cut ({removedCount})
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
                  {themes.map((t) => (
                    <div key={t.id} className="group/theme relative">
                      <button
                        data-style={t.id}
                        onClick={() => setTheme(t.id)}
                        className={`flex w-full items-center gap-2.5 rounded-lg py-2 pl-2.5 pr-8 text-left transition hover:bg-white/[.07] ${
                          t.id === v.theme ? 'bg-[var(--color-accent)]/25' : ''
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
                  {slider('Height', v.height, 12, 100, setHeight)}
                  {slider('Vertical position', v.pos, 0, 100, setPos)}
                  <div className="px-2.5 pb-1 pt-1 text-[11px] text-[var(--color-dim)]">Width</div>
                  <div className="flex gap-1 px-1.5">
                    {WIDTH_LABELS.map(([w, label]) => (
                      <button
                        key={w}
                        onClick={() => setWidth(w)}
                        className={`flex-1 rounded-lg px-2 py-1.5 text-[11.5px] font-semibold transition hover:bg-white/[.07] ${
                          w === v.width ? 'bg-[var(--color-accent)]/25 text-white' : 'text-[var(--color-dim)]'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                    <button
                      onClick={() => setLogo(!v.logo)}
                      className={`flex-1 rounded-lg px-2 py-1.5 text-[11.5px] font-semibold transition hover:bg-white/[.07] ${
                        v.logo ? 'bg-[var(--color-accent)]/25 text-white' : 'text-[var(--color-dim)]'
                      }`}
                    >
                      Artwork
                    </button>
                  </div>
                  <div className="px-2.5 pb-1 pt-2 text-[11px] text-[var(--color-dim)]">Drop effect</div>
                  <div className="grid grid-cols-11 gap-1 px-1.5">
                    {Array.from({ length: DROP_VARIANTS }, (_, i) => i + 1).map((n) => (
                      <button
                        key={n}
                        onClick={() => pickDrop(n)}
                        title={`Drop variant ${n}`}
                        className={`rounded-lg py-1.5 text-[11.5px] font-semibold transition hover:bg-white/[.07] ${
                          n === v.drop ? 'bg-[var(--color-accent)]/25 text-white' : 'text-[var(--color-dim)]'
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

          {/* transport overlays the bottom edge; its shape comes from the chosen
              style, its progress colour from --color-bar. In fullscreen it slides
              out of view when the chrome hides. */}
          <div
            className={`absolute inset-x-0 bottom-0 z-10 transition-transform duration-300 ${
              transportBg ? 'bg-[#12141b]' : ''
            } ${chromeVisible ? 'translate-y-0' : 'translate-y-full'}`}
            style={bar ? ({ '--color-bar': bar } as CSSProperties) : undefined}
          >
            <Transport c={c} style={transportStyle} peaks={peaks} />
          </div>
        </>
      )}
    </div>
  )
}
