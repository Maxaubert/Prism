import { useCallback, useEffect, useRef, useState, type JSX, type SyntheticEvent } from 'react'
import { useMediaControls } from '../lib/useMediaControls'
import { Transport } from './Transport'
import { Visualizer } from './Visualizer'
import { VIZ_STYLES, DEFAULT_STYLE_ID } from '../lib/viz/styles'

// The audio player: the chosen visualizer fills the window, with a gear menu for
// picking a style and shaping how it sits. The filename stays in the title bar
// rather than on the glass. The <audio> element is hidden and crossorigin so the
// visualizer's AnalyserNode can read its samples (see fsmedia in main).

const STYLE_KEY = 'prism.viz.style'
const WIDTH_KEY = 'prism.viz.width'
const LOGO_KEY = 'prism.viz.logo'
const HEIGHT_KEY = 'prism.viz.height'
const POS_KEY = 'prism.viz.pos'

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
  const [width, setWidth] = useState<string>(() => localStorage.getItem(WIDTH_KEY) || 'full')
  const [logo, setLogo] = useState<boolean>(() => localStorage.getItem(LOGO_KEY) === '1')
  const [height, setHeight] = useState<number>(() => num(HEIGHT_KEY, 100)) // % of the stage
  const [pos, setPos] = useState<number>(() => num(POS_KEY, 50)) // % from the top
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
  const toggleLogo = (): void => {
    setLogo((x) => {
      localStorage.setItem(LOGO_KEY, x ? '0' : '1')
      return !x
    })
  }

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

  // While the menu is open the arrow keys walk the style list and apply each one
  // as you go, so styles can be compared quickly. Capture phase + stopPropagation
  // keeps the media hook from also treating them as volume.
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      e.stopPropagation()
      const i = VIZ_STYLES.findIndex((s) => s.id === styleId)
      const step = e.key === 'ArrowDown' ? 1 : -1
      const next = VIZ_STYLES[(i + step + VIZ_STYLES.length) % VIZ_STYLES.length]
      applyStyle(next.id)
      listRef.current
        ?.querySelector(`[data-style="${next.id}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [menuOpen, styleId, applyStyle])

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
    <div className="relative flex h-full w-full flex-col bg-[#0d0f14]">
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
        <div className="grid flex-1 place-items-center p-8 text-center text-sm text-[#c9ccd6]">
          {c.error}
        </div>
      ) : (
        <>
          <div className="relative min-h-0 flex-1">
            {/* Height and vertical position are driven from the gear, so the band
                can be sized and placed without touching any style's code. */}
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
                <Visualizer media={mediaEl} styleId={styleId} />
              </div>
            </div>

            {logo && (
              <div className="pointer-events-none absolute inset-x-0 top-[15%] flex justify-center">
                <Logo />
              </div>
            )}
          </div>

          {/* settings gear */}
          <div data-viz-menu className="absolute right-3 top-3 z-10">
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
                <div className="flex items-baseline justify-between px-3 pb-1 pt-2.5">
                  <span className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--color-dim)]">
                    Visualizer
                  </span>
                  <span className="text-[10px] text-[var(--color-dim)]">↑ ↓ to browse</span>
                </div>

                <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-1.5">
                  {VIZ_STYLES.map((s) => (
                    <button
                      key={s.id}
                      data-style={s.id}
                      onClick={() => applyStyle(s.id)}
                      className={`block w-full rounded-lg px-2.5 py-2 text-left transition hover:bg-white/[.07] ${
                        s.id === styleId ? 'bg-[var(--color-accent)]/25' : ''
                      }`}
                    >
                      <div className="text-[13px] font-semibold text-[#e9ecf5]">{s.name}</div>
                      <div className="mt-0.5 text-[11px] leading-snug text-[var(--color-dim)]">
                        {s.blurb}
                      </div>
                    </button>
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
                </div>
              </div>
            )}
          </div>

          {/* transport */}
          <div className="shrink-0 border-t border-white/[.06] bg-[#12141b] px-4 py-3">
            <Transport c={c} />
          </div>
        </>
      )}
    </div>
  )
}
