import { useEffect, useRef, useState, type JSX } from 'react'
import { RATES, type MediaControls } from '../lib/useMediaControls'
import { setPlayerPref, usePlayerPrefs } from '../lib/playerPrefs'
import type { SubTrackInfo } from '../lib/useSubtitles'

// The cog at the right of both transports, where the speed button used to be:
// playback speed, loop, autoplay (the next video or track when this one ends),
// and - on video - the sidecar subtitle tracks found next to the file.

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
      >
        <span
          className={`absolute top-[2px] h-[10px] w-[10px] rounded-full bg-white transition-[left] ${
            on ? 'left-[14px]' : 'left-[2px]'
          }`}
        />
      </span>
    </button>
  )
}

const Rule = (): JSX.Element => <div className="my-1 h-px bg-[var(--p-divider)]" />

const Label = ({ text }: { text: string }): JSX.Element => (
  <div className="px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[.1em] text-[var(--p-dim2)]">
    {text}
  </div>
)

export function PlayerMenu({
  c,
  autoplayHint,
  subtitles
}: {
  c: MediaControls
  /** What autoplay means for this player ("video" / "track"). */
  autoplayHint: string
  /** The video player's tracks; audio passes nothing and shows no section. */
  subtitles?: {
    tracks: SubTrackInfo[]
    active: string | null
    onPick: (path: string | null) => void
  }
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const prefs = usePlayerPrefs()
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (): void => setOpen(false)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
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

  return (
    <div ref={box} className="relative" data-owns-escape={open ? '' : undefined}>
      <button
        className={`grid place-items-center ${open ? 'text-[var(--color-accent-hi)]' : 'hover:text-[var(--color-accent-hi)]'}`}
        onClick={() => setOpen((v) => !v)}
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
          className="absolute bottom-9 right-0 z-30 w-[210px] overflow-hidden rounded-[6px] border border-[color:var(--p-divider)] bg-[var(--p-side-flat)] py-1 font-normal shadow-[0_10px_28px_rgba(0,0,0,.5)]"
        >
          <Label text="Speed" />
          <div className="grid grid-cols-4 gap-1 px-2 pb-1.5">
            {RATES.map((r) => (
              <button
                key={r}
                role="menuitemradio"
                aria-checked={r === c.rate}
                onClick={() => c.setRate(r)}
                className={`rounded-[4px] py-1 text-[11.5px] font-semibold tabular-nums transition-colors ${
                  r === c.rate
                    ? 'bg-[var(--p-accent)] text-[var(--p-on-accent)]'
                    : 'text-[var(--p-text-soft)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]'
                }`}
              >
                {r}×
              </button>
            ))}
          </div>
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
          {subtitles && (
            <>
              <Rule />
              <Label text="Subtitles" />
              {subtitles.tracks.length === 0 ? (
                <div className="px-3 pb-2 text-[11.5px] italic text-[var(--p-dim2)]">
                  none found next to the file
                </div>
              ) : (
                <>
                  <SubRow label="Off" active={subtitles.active === null} onPick={() => subtitles.onPick(null)} />
                  {subtitles.tracks.map((t) => (
                    <SubRow
                      key={t.path}
                      label={t.label}
                      active={subtitles.active === t.path}
                      onPick={() => subtitles.onPick(t.path)}
                    />
                  ))}
                </>
              )}
            </>
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
