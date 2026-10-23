import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { LIMITED_LANGUAGES_TEXT } from '../../../shared/dictationCatalog'
import { formatHotkey, parseHotkeyFromEvent, usableHotkey, type Hotkey } from '../../lib/dictationKey'
import { defaultDictationHotkey, setDictationHotkey, setDictationMic } from '../../lib/dictationPrefs'
import { listMics, startCapture, type Capture } from '../../lib/micCapture'
import { Select } from '../fields'

// DICTATION'S CONTROLS, once for both layouts of its page (2026-10-05): the
// key capture, the microphone and its meter, the limited-language mark, the
// Uninstall button and the failure texts. Moved out of Dictation.tsx
// unchanged, apart from the microphone being able to say its problem in the
// row's subtext.

export const button =
  'rounded-md border border-[color:var(--p-divider)] bg-[var(--p-control)] px-3 py-1 text-[11.5px] font-semibold text-[var(--p-text)] transition hover:bg-[var(--p-hover)] disabled:opacity-50'
// The step that moves things along (a download, picking a model) is marked by
// a stronger grey, never the accent: settings buttons are neutral, only Save
// is accented (see ROW_BUTTON in fields).
export const primary =
  'rounded-md border border-[color:var(--p-line)] bg-[color-mix(in_srgb,var(--p-text)_12%,var(--p-control))] px-3 py-1 text-[11.5px] font-semibold text-[var(--p-text)] transition hover:bg-[color-mix(in_srgb,var(--p-text)_18%,var(--p-control))] disabled:opacity-50'

/** Click, then press the key or chord. A bare modifier (Right Alt, Prism's default)
 *  is taken on its RELEASE, so that Ctrl+Shift+D is not captured as "Ctrl". */
export function HotkeyField({
  value,
  disabled,
  look = button
}: {
  value: Hotkey
  disabled: boolean
  /** The Reset button's class, when the row wants its own. */
  look?: string
}): JSX.Element {
  const [listening, setListening] = useState(false)
  useEffect(() => {
    if (!listening) return
    let bare: Hotkey | null = null
    const isModifier = (code: string): boolean => /^(Alt|Control|Shift|Meta)(Left|Right)$/.test(code)
    const down = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.repeat) return
      if (e.code === 'Escape') return setListening(false)
      const hk = parseHotkeyFromEvent(e)
      if (!hk) return
      if (isModifier(e.code)) bare = hk
      // A key that types, or a chord the terminal owns, is not taken (#27):
      // the field keeps listening for one that can be.
      else if (usableHotkey(hk)) {
        setDictationHotkey(hk)
        setListening(false)
      }
    }
    const up = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (bare && bare.code === e.code) {
        setDictationHotkey(bare)
        setListening(false)
      }
    }
    const stop = (): void => setListening(false)
    // A press anywhere else ends the capture: left armed, the next key typed
    // on the page became the dictation key. The button's own press is its
    // click's to answer.
    const away = (e: PointerEvent): void => {
      if (!(e.target instanceof Element && e.target.closest('#dictation-hotkey'))) setListening(false)
    }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('blur', stop)
    window.addEventListener('pointerdown', away, true)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('blur', stop)
      window.removeEventListener('pointerdown', away, true)
    }
  }, [listening])
  // The HOST's default (Right Alt in Prism, Ctrl+Win in Prism Terminal).
  const fallback = defaultDictationHotkey()
  const isDefault = JSON.stringify(value) === JSON.stringify(fallback)
  return (
    <div className="flex items-center gap-2">
      {!isDefault && !listening && (
        <button className={look} disabled={disabled} onClick={() => setDictationHotkey(fallback)}>
          Reset
        </button>
      )}
      <button
        id="dictation-hotkey"
        data-hotkey-capture={listening ? 'on' : 'off'}
        disabled={disabled}
        onClick={() => setListening((v) => !v)}
        className={`min-w-[112px] rounded-md border px-3 py-1 text-center font-mono text-[11.5px] font-semibold transition disabled:opacity-50 ${
          listening
            ? 'border-[color:var(--p-accent-hi)] text-[var(--p-accent-hi)]'
            : 'border-[color:var(--p-divider)] bg-[var(--p-control)] text-[var(--p-text)] hover:bg-[var(--p-hover)]'
        }`}
      >
        {listening ? 'Press a key…' : formatHotkey(value)}
      </button>
    </div>
  )
}

/** The mic picker, and a meter behind a button: a dead or muted microphone is
 *  found here, in ten seconds, instead of after a lost dictation. */
export function MicField({
  value,
  disabled,
  onProblem,
  look = button,
  idleTrack = false
}: {
  value: string
  disabled: boolean
  /** Say a problem elsewhere (the grouped cards row's subtext) instead of
   *  beside the control. */
  onProblem?: (problem: string | null) => void
  /** The Test button's class, when the row wants its own. */
  look?: string
  /** Draw the meter's empty track while not testing, so the row does not
   *  change shape when a test starts. */
  idleTrack?: boolean
}): JSX.Element {
  const [mics, setMics] = useState<Array<{ id: string; label: string }>>([])
  const [testing, setTesting] = useState(false)
  const [problem, setProblemHere] = useState<string | null>(null)
  const said = useRef(onProblem)
  useEffect(() => {
    said.current = onProblem
  })
  const setProblem = useCallback((p: string | null): void => {
    setProblemHere(p)
    said.current?.(p)
  }, [])
  const bar = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    void listMics().then(setMics)
  }, [testing])
  useEffect(() => {
    if (!testing) return
    let cap: Capture | null = null
    let dead = false
    let shown = 0
    void startCapture({
      deviceId: value || undefined,
      onLevel: (l) => {
        shown = l > shown ? l : shown * 0.85 + l * 0.15
        if (bar.current) bar.current.style.transform = `scaleX(${Math.min(1, shown)})`
      }
    })
      .then((c) => {
        if (dead) c.stop()
        else cap = c
      })
      .catch((err) => {
        setProblem(err === 'denied' ? 'Microphone access was refused.' : 'No working microphone was found.')
        setTesting(false)
      })
    const timer = window.setTimeout(() => setTesting(false), 10000)
    return () => {
      dead = true
      clearTimeout(timer)
      cap?.stop()
    }
  }, [testing, value, setProblem])
  return (
    <div className="flex items-center gap-2">
      {testing ? (
        <span
          data-mic-meter
          className="block h-1.5 w-24 overflow-hidden rounded-full bg-[var(--p-track)]"
          title="Speak: the bar should move"
        >
          <span
            ref={bar}
            className="block h-full w-full origin-left rounded-full bg-[var(--p-accent-hi)]"
            style={{ transform: 'scaleX(0)', transition: 'transform 80ms linear' }}
          />
        </span>
      ) : idleTrack ? (
        <span aria-hidden className="block h-1.5 w-24 rounded-full bg-[var(--p-track)]" />
      ) : (
        problem && !onProblem && <span className="text-[11.5px] text-[var(--p-dim)]">{problem}</span>
      )}
      <button
        className={look}
        disabled={disabled}
        onClick={() => {
          setProblem(null)
          setTesting((v) => !v)
        }}
      >
        {testing ? 'Stop' : 'Test'}
      </button>
      <Select
        id="dictation-mic"
        value={mics.some((m) => m.id === value) ? value : ''}
        onChange={setDictationMic}
        options={[{ id: '', name: 'System default' }, ...mics.map((m) => ({ id: m.id, name: m.label }))]}
      />
    </div>
  )
}

/** Beside the language picker while the active model picks its own language
 *  (#121; owner, 2026-10-04: "in the language drop down have an icon to
 *  indicate that it doesn't support all languages"). A globe in the dim ink,
 *  and the same one line as the download question on hover. */
export function LimitedMark(): JSX.Element {
  return (
    <span
      data-language-limited
      role="img"
      aria-label={LIMITED_LANGUAGES_TEXT}
      title={LIMITED_LANGUAGES_TEXT}
      className="grid h-6 w-6 cursor-default place-items-center text-[var(--p-dim)]"
    >
      <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
      </svg>
    </span>
  )
}

/** "X Uninstall" (owner, 2026-09-19): it frees the disk, and says so by name.
 *  A BUTTON, the same one Download is: a first cut drew it as bare text to keep
 *  the destructive control quiet, and it read as a label rather than something
 *  to press (owner, the same evening). */
export function Uninstall({ onClick, what, look = button }: { onClick: () => void; what: string; look?: string }): JSX.Element {
  return (
    <button
      data-uninstall
      onClick={onClick}
      title={`Delete ${what} from this PC. Prism and Prism Terminal share it.`}
      className={`flex items-center gap-1.5 ${look}`}
    >
      <svg viewBox="0 0 24 24" width={11} height={11} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
      Uninstall
    </button>
  )
}
