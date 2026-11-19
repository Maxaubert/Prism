import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { SWITCH_KNOB_ON, SWITCH_ON, Slider } from 'prism-term-core/renderer/settings/fields'
import type { MediaControls } from '../hooks/useMediaControls'
import { setPlayerPref, usePlayerPrefs } from '../lib/prefs/playerPrefs'
import { useDismiss } from '../hooks/useDismiss'
import type { SubTrackInfo } from '../hooks/useSubtitles'
import { Gear, Icon } from './icons/Icon'
import { MENU_PANEL, MENU_ROW, MENU_ROW_INK, stepRow } from './menuLook'

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
      className={`${MENU_ROW} ${MENU_ROW_INK}`}
    >
      {label}
      <span
        // The core switch's colours at a menu's size (#318): every switch in
        // the app wears one look, the style's accent with its own ink when on.
        className={`relative h-[14px] w-[26px] rounded-full transition-colors ${
          on ? SWITCH_ON : 'bg-[var(--p-track)]'
        }`}
        aria-hidden
        // Markers for the phone's size pass (phone.css, #145); the sizes
        // here are the desktop's and do not move.
        data-menu-switch
        data-on={on || undefined}
      >
        <span
          className={`absolute top-[2px] h-[10px] w-[10px] rounded-full transition-[left] ${
            on ? `left-[14px] ${SWITCH_KNOB_ON}` : 'left-[2px] bg-white'
          }`}
          data-menu-knob
        />
      </span>
    </button>
  )
}

const Chevron = ({ back = false }: { back?: boolean }): JSX.Element => (
  <Icon name="chevronRight" size={12} weight="2.2" className={back ? 'rotate-180' : ''} />
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
      className={`gap-2 ${MENU_ROW} ${MENU_ROW_INK}`}
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
      className={`justify-start gap-2 font-semibold ${MENU_ROW} text-[var(--p-text)] hover:bg-[var(--p-hover)]`}
    >
      <Chevron back />
      {label}
    </button>
  )
}

/** The menu's focusable rows, in order (the Custom reset and the slider are Tab's). */
const menuRows = (el: HTMLElement | null): HTMLElement[] =>
  [...(el?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])]

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
  const sheet = useRef<HTMLDivElement>(null)

  useEffect(() => {
    onOpenChange?.(open)
    return () => onOpenChange?.(false) // unmounting always reads as closed
  }, [open, onOpenChange])

  useDismiss(
    open,
    box,
    // Closing forgets the level: the menu reopens at the top, as YouTube's does.
    () => {
      setOpen(false)
      setLevel('top')
    },
    {
      // Escape climbs one level; at the top it closes.
      onEscape: () =>
        setLevel((l) => {
          if (l === 'top') {
            setOpen(false)
            return l
          }
          return 'top'
        })
    }
  )

  // Keyboard (#522): moving between levels unmounts the row that had the
  // focus, which dropped it on the page. The new level's first row takes it
  // back (not on the first open: the cog keeps the focus then).
  const lastLevel = useRef<Level>('top')
  useEffect(() => {
    if (!open || lastLevel.current === level) return
    lastLevel.current = level
    menuRows(sheet.current)[0]?.focus()
  }, [open, level])
  useEffect(() => {
    if (!open) lastLevel.current = 'top'
  }, [open])
  /** Up and Down walk the rows, wrapping, like the right-click menu. */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const list = menuRows(sheet.current)
    if (list.length === 0) return
    e.preventDefault()
    list[stepRow(list.length, list.indexOf(document.activeElement as HTMLElement), e.key)].focus()
  }

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
        <Gear size={19} />
      </button>

      {open && (
        <div
          ref={sheet}
          onKeyDown={onKeyDown}
          role="menu"
          aria-label="Player settings"
          data-menu-level={level}
          // The phone turns this popover into a bottom sheet from its own
          // stylesheet (#145), keyed on this marker.
          data-player-menu
          // max-h + scroll: short windows would otherwise clip the menu against
          // the viewer pane's overflow-hidden with no way to reach the bottom.
          className={`absolute bottom-9 right-0 z-30 max-h-[min(60vh,420px)] w-[230px] overflow-y-auto font-normal [scrollbar-width:thin] ${MENU_PANEL}`}
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
                <Slider
                  variant="menu"
                  min={0.25}
                  max={2}
                  step={0.05}
                  value={c.rate}
                  onChange={c.setRate}
                  onReset={() => c.setRate(1)}
                  label="Playback speed"
                  format={speedLabel}
                  data={{ 'data-menu-slider': '' }}
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
      className={`${MENU_ROW} hover:bg-[var(--p-hover)] ${
        active ? 'text-[var(--p-accent-hi)]' : MENU_ROW_INK
      }`}
    >
      <span className="truncate">{label}</span>
      {active && (
        <Icon name="tickWide" size={12} weight="2.4" />
      )}
    </button>
  )
}
