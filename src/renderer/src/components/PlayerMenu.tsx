import { useEffect, useRef, useState, type JSX } from 'react'
import type { MediaControls } from '../lib/useMediaControls'
import { setPlayerPref, usePlayerPrefs } from '../lib/playerPrefs'
import type { SubTrackInfo } from '../lib/useSubtitles'

// The cog at the right of both transports, where the speed button used to be.
// SUBMENUS since #122 (owner: "things should be split into sub menus, not all
// in one big menu"): the top level is one row per setting - Speed, Audio
// track, Subtitles, Aspect ratio - each showing its current value and opening
// its own list with a back row, YouTube's settings shape; the three toggles
// (loop, autoplay, pause in background) stay at the top level, being one tap
// each. Same component for the PC and the phone: on the phone the cog is the
// only way to these pickers, there being no right-click menu on a film.

function Toggle({
  label,
  hint,
  on,
  onChange
}: {
  label: string
  hint: string
  on: boolean
  onChange: (v: boolean) => void
}): JSX.Element {
  return (
    <button
      role="menuitemcheckbox"
      aria-checked={on}
      title={hint}
      onClick={() => onChange(!on)}
      className="flex h-[30px] w-full items-center justify-between px-3 text-[12.5px] text-[var(--p-text-soft)] transition-colors hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]"
    >
      {label}
      <span
        className={`relative h-[14px] w-[26px] rounded-full transition-colors ${
          on ? 'bg-[var(--p-accent)]' : 'bg-[var(--p-track)]'
        }`}
        aria-hidden
        // Markers for the phone's size pass (phone.css, #145); the sizes
        // here are the desktop's and do not move.
        data-menu-switch
        data-on={on || undefined}
      >
        <span
          className={`absolute top-[2px] h-[10px] w-[10px] rounded-full bg-white transition-[left] ${
            on ? 'left-[14px]' : 'left-[2px]'
          }`}
          data-menu-knob
        />
      </span>
    </button>
  )
}

const Rule = (): JSX.Element => <div className="my-1 h-px bg-[var(--p-divider)]" />

const Chevron = ({ back = false }: { back?: boolean }): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    width={12}
    height={12}
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    className={back ? 'rotate-180' : ''}
  >
    <path d="M9 6l6 6-6 6" />
  </svg>
)

/** A top-level row: the setting, its current value, and the way in. */
function MenuRow({
  id,
  label,
  value,
  onOpen
}: {
  id: string
  label: string
  value: string
  onOpen: () => void
}): JSX.Element {
  return (
    <button
      role="menuitem"
      aria-haspopup="menu"
      data-menu-row={id}
      onClick={onOpen}
      className="flex h-[30px] w-full items-center justify-between gap-2 px-3 text-[12.5px] text-[var(--p-text-soft)] transition-colors hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]"
    >
      <span className="shrink-0">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5 text-[var(--p-dim2)]">
        <span className="truncate" data-menu-value={id}>
          {value}
        </span>
        <Chevron />
      </span>
    </button>
  )
}

/** The way back up, at the head of every sub-list. */
function BackRow({ label, onBack }: { label: string; onBack: () => void }): JSX.Element {
  return (
    <button
      role="menuitem"
      data-menu-back
      onClick={onBack}
      className="flex h-[30px] w-full items-center gap-2 border-b border-[color:var(--p-divider)] px-3 text-[12.5px] font-semibold text-[var(--p-text)] transition-colors hover:bg-[var(--p-hover)]"
    >
      <Chevron back />
      {label}
    </button>
  )
}

type Level = 'top' | 'speed' | 'audio' | 'subtitles' | 'picture'

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]
const speedLabel = (r: number): string => (r === 1 ? 'Normal' : `${r}×`)

export function PlayerMenu({
  c,
  autoplayHint,
  subtitles,
  picture,
  audio,
  onOpenChange
}: {
  c: MediaControls
  /** What autoplay means for this player ("video" / "track"). */
  autoplayHint: string
  /** The video player's tracks; audio passes nothing and shows no row.
   *  ALWAYS a row for a video since #120, found or not: on the phone there
   *  is no right-click menu, so a picker that hid itself when nothing was
   *  found left no way to tell "none found" from "not offered". `onAdd` is
   *  the PC's file dialog and is absent on the phone. */
  subtitles?: {
    tracks: SubTrackInfo[]
    active: string | null
    onPick: (path: string | null) => void
    onAdd?: () => void
  }
  /** The aspect ratio (#120): fit, fill, stretch, 16:9, 4:3. Video only. */
  picture?: {
    options: ReadonlyArray<{ id: string; label: string }>
    active: string
    onPick: (id: string) => void
  }
  /** The file's audio tracks, when it has more than one (#120). Video only;
   *  a list of one is chrome, so the caller passes nothing then. */
  audio?: {
    tracks: ReadonlyArray<{ index: number; label: string }>
    active: number | null
    onPick: (index: number | null) => void
  }
  /** The player pins its auto-hiding chrome while the menu is open: an
   *  invisible-but-interactive menu would eat clicks and the first Escape. */
  onOpenChange?: (open: boolean) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [level, setLevel] = useState<Level>('top')
  const prefs = usePlayerPrefs()
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    onOpenChange?.(open)
    return () => onOpenChange?.(false) // unmounting always reads as closed
  }, [open, onOpenChange])

  useEffect(() => {
    if (!open) return
    // Closing forgets the level: the menu reopens at the top, as YouTube's does.
    const close = (): void => {
      setOpen(false)
      setLevel('top')
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      // Escape climbs one level; at the top it closes.
      setLevel((l) => {
        if (l === 'top') {
          setOpen(false)
          return l
        }
        return 'top'
      })
    }
    const onDown = (e: PointerEvent): void => {
      if (!box.current?.contains(e.target as Node)) close()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('blur', close)
    }
  }, [open])

  const audioValue = audio ? (audio.tracks.find((t) => t.index === audio.active)?.label ?? 'Default') : ''
  const subsValue = subtitles ? (subtitles.tracks.find((t) => t.path === subtitles.active)?.label ?? 'Off') : ''
  const pictureValue = picture ? (picture.options.find((o) => o.id === picture.active)?.label ?? '') : ''
  const speedValue = `${c.rate.toFixed(2)}×`
  /** Pick, then back to the top: what was chosen is on the row's value. */
  const pickAnd = (fn: () => void): (() => void) => () => {
    fn()
    setLevel('top')
  }

  return (
    <div ref={box} className="relative" data-owns-escape={open ? '' : undefined}>
      <button
        className={`grid place-items-center ${open ? 'text-[var(--color-accent-hi)]' : 'hover:text-[var(--color-accent-hi)]'}`}
        onClick={() => {
          setOpen((v) => !v)
          setLevel('top')
        }}
        title="Player settings"
        aria-label="Player settings"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <circle cx="12" cy="12" r="3.2" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.35.4.64.73.83H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Player settings"
          data-menu-level={level}
          // The phone turns this popover into a bottom sheet from its own
          // stylesheet (#145), keyed on this marker.
          data-player-menu
          // max-h + scroll: short windows would otherwise clip the menu against
          // the viewer pane's overflow-hidden with no way to reach the bottom.
          className="absolute bottom-9 right-0 z-30 max-h-[min(60vh,420px)] w-[230px] overflow-y-auto rounded-[6px] border border-[color:var(--p-divider)] bg-[var(--p-side-flat)] py-1 font-normal shadow-[0_10px_28px_rgba(0,0,0,.5)] [scrollbar-width:thin]"
        >
          {level === 'top' && (
            <>
              <MenuRow id="speed" label="Speed" value={speedValue} onOpen={() => setLevel('speed')} />
              {audio && <MenuRow id="audio" label="Audio track" value={audioValue} onOpen={() => setLevel('audio')} />}
              {subtitles && (
                <MenuRow id="subtitles" label="Subtitles" value={subsValue} onOpen={() => setLevel('subtitles')} />
              )}
              {picture && (
                <MenuRow id="picture" label="Aspect ratio" value={pictureValue} onOpen={() => setLevel('picture')} />
              )}
              <Rule />
              <Toggle
                label="Loop"
                hint="Start this file over when it ends."
                on={prefs.loop}
                onChange={(v) => setPlayerPref('loop', v)}
              />
              <Toggle
                label="Autoplay"
                hint={`Play the next ${autoplayHint} in the folder when this one ends.`}
                on={prefs.autoplay}
                onChange={(v) => setPlayerPref('autoplay', v)}
              />
              <Toggle
                label="Pause in background"
                hint="Pause when you click away or minimise Prism, and carry on when you come back."
                on={prefs.background}
                onChange={(v) => setPlayerPref('background', v)}
              />
            </>
          )}
          {level === 'speed' && (
            <div data-menu-section="speed">
              <BackRow label="Speed" onBack={() => setLevel('top')} />
              {SPEEDS.map((r) => (
                <SubRow
                  key={r}
                  label={speedLabel(r)}
                  active={Math.abs(c.rate - r) < 0.01}
                  onPick={pickAnd(() => c.setRate(r))}
                />
              ))}
              {/* Anything in between: the slider, with the readout as its reset. */}
              <div className="flex items-center justify-between px-3 pb-0.5 pt-2">
                <span className="text-[10.5px] font-semibold uppercase tracking-[.1em] text-[var(--p-dim2)]">Custom</span>
                <button
                  className="rounded px-1 text-[11.5px] font-semibold tabular-nums text-[var(--p-text-soft)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]"
                  onClick={() => c.setRate(1)}
                  title="Back to 1×"
                >
                  {speedValue}
                </button>
              </div>
              <div className="px-3 pb-2">
                <input
                  type="range"
                  min={0.25}
                  max={2}
                  step={0.05}
                  value={c.rate}
                  onChange={(e) => c.setRate(Number(e.target.value))}
                  onDoubleClick={() => c.setRate(1)}
                  aria-label="Playback speed"
                  data-menu-slider
                  className="h-1 w-full cursor-pointer appearance-none rounded-full bg-[var(--p-track)]"
                  style={{ accentColor: 'var(--p-accent)' }}
                />
              </div>
            </div>
          )}
          {level === 'audio' && audio && (
            <div data-menu-section="audio">
              <BackRow label="Audio track" onBack={() => setLevel('top')} />
              <SubRow label="Default" active={audio.active === null} onPick={pickAnd(() => audio.onPick(null))} />
              {audio.tracks.map((t) => (
                <SubRow
                  key={t.index}
                  label={t.label}
                  active={audio.active === t.index}
                  onPick={pickAnd(() => audio.onPick(t.index))}
                />
              ))}
            </div>
          )}
          {level === 'subtitles' && subtitles && (
            <div data-menu-section="subtitles">
              <BackRow label="Subtitles" onBack={() => setLevel('top')} />
              <SubRow label="Off" active={subtitles.active === null} onPick={pickAnd(() => subtitles.onPick(null))} />
              {subtitles.tracks.map((t) => (
                <SubRow
                  key={t.path}
                  label={t.label}
                  active={subtitles.active === t.path}
                  onPick={pickAnd(() => subtitles.onPick(t.path))}
                />
              ))}
              {subtitles.onAdd && <SubRow label="Add subtitle file…" active={false} onPick={pickAnd(subtitles.onAdd)} />}
            </div>
          )}
          {level === 'picture' && picture && (
            <div data-menu-section="picture">
              <BackRow label="Aspect ratio" onBack={() => setLevel('top')} />
              {picture.options.map((o) => (
                <SubRow
                  key={o.id}
                  label={o.label}
                  active={picture.active === o.id}
                  onPick={pickAnd(() => picture.onPick(o.id))}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SubRow({ label, active, onPick }: { label: string; active: boolean; onPick: () => void }): JSX.Element {
  return (
    <button
      role="menuitemradio"
      aria-checked={active}
      onClick={onPick}
      className={`flex h-[28px] w-full items-center justify-between px-3 text-[12.5px] transition-colors hover:bg-[var(--p-hover)] ${
        active ? 'text-[var(--p-accent-hi)]' : 'text-[var(--p-text-soft)] hover:text-[var(--p-text)]'
      }`}
    >
      <span className="truncate">{label}</span>
      {active && (
        <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4.5 12.5l5 5 10-11" />
        </svg>
      )}
    </button>
  )
}
