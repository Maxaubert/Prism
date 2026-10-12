import { useEffect, useRef, useState, type JSX } from 'react'
import { LAYER } from '../components/layers'

// THE SETTINGS FIELDS, shared by both hosts (#15). The owner's rule: the two
// apps' terminal settings are the same settings, "the setting names, types, how
// they function", and only the personal values differ (each app keeps its own).
// So the controls a terminal setting is built from live here, once. They wear
// the `--p-*` tokens both apps define, and nothing else.

/** A real on/off switch: one control, one state, no pair of buttons to compare. */
export function Switch({
  on,
  onChange,
  label,
  disabled
}: {
  on: boolean
  onChange: (b: boolean) => void
  label: string
  disabled?: boolean
}): JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-[20px] w-[36px] shrink-0 rounded-full transition-[background-color,filter,opacity] disabled:cursor-default ${
        on ? SWITCH_ON : 'bg-[var(--p-track)]'
      }`}
    >
      <span
        className={`absolute left-[2px] top-[2px] h-4 w-4 rounded-full shadow-sm transition-transform duration-150 ease-out ${
          on ? SWITCH_KNOB_ON : 'bg-white'
        }`}
        style={{ transform: on ? 'translateX(16px)' : 'none' }}
      />
    </button>
  )
}

/** Two or three exclusive choices as one control rather than a row of buttons. */
export function Segmented<T extends string>({
  value,
  onChange,
  options
}: {
  value: T
  onChange: (v: T) => void
  options: Array<{ id: T; name: string }>
}): JSX.Element {
  return (
    <div className="inline-flex gap-0.5 rounded-full border border-[color:var(--p-divider)] bg-[var(--p-control)] p-[3px]">
      {options.map((o) => {
        const on = o.id === value
        return (
          <button
            key={o.id}
            data-seg={o.id}
            onClick={() => onChange(o.id)}
            aria-pressed={on}
            className={`rounded-full px-3 py-1 text-[11.5px] font-semibold transition ${
              on
                ? SEGMENT_ON
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

/** The one save button: accent while there is something to save, quietly grey
 *  when there is not. */
export function SaveButton({ dirty, onClick, title }: { dirty: boolean; onClick: () => void; title: string }): JSX.Element {
  return (
    <button
      data-save-term
      onClick={onClick}
      disabled={!dirty}
      title={dirty ? title : 'Nothing to save yet'}
      className={`shrink-0 rounded-[var(--p-radius-sm)] border px-3 py-1 text-[11.5px] font-semibold transition ${
        dirty
          ? // The edge is transparent over the fill: a see-through accent (#114)
            // painted on both would lay its alpha twice there, a darker ring.
            'border-transparent bg-[var(--p-accent)] text-[var(--p-on-accent)] hover:brightness-110'
          : 'cursor-default border-[color:var(--p-line)] bg-[var(--p-hover)] text-[var(--p-dim2)]'
      }`}
    >
      Save changes
    </button>
  )
}

/** A styled dropdown, not a native select: the popup wears the app's own menu
 *  look (flat panel, hover token, a check on the active row), and each option
 *  can carry a style - which is how the font picker previews its faces. */
export function Select({
  id,
  value,
  onChange,
  options,
  disabled
}: {
  id: string
  value: string
  onChange: (v: string) => void
  options: Array<{ id: string; name: string; style?: React.CSSProperties }>
  /** Shown but not changeable: the value in force while something else decides it. */
  disabled?: boolean
}): JSX.Element {
  const [open, setOpen] = useState(false)
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
  const cur = options.find((o) => o.id === value)
  return (
    <div ref={box} className="relative">
      <button
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 min-w-[168px] items-center justify-between gap-2 rounded-[var(--p-radius-sm)] border border-[color:var(--p-divider)] bg-[var(--p-control)] px-2.5 text-[12px] font-medium text-[var(--p-text)] transition-colors hover:border-[color:var(--p-line)] focus-visible:border-[var(--p-accent-hi)] focus-visible:outline-none disabled:opacity-50 disabled:hover:border-[color:var(--p-divider)]"
      >
        <span className="truncate" style={cur?.style}>
          {cur?.name ?? value}
        </span>
        <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-[var(--p-dim)] transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && !disabled && (
        <div
          role="listbox"
          aria-labelledby={id}
          className={`absolute right-0 ${LAYER.pop} mt-1 max-h-[300px] min-w-full overflow-y-auto rounded-[2px] border border-[color:var(--p-divider)] bg-[var(--p-side-flat)] py-0.5 shadow-[0_10px_28px_rgba(0,0,0,.5)]`}
        >
          {options.map((o) => {
            const on = o.id === value
            return (
              <button
                key={o.id}
                role="option"
                aria-selected={on}
                onClick={() => {
                  onChange(o.id)
                  setOpen(false)
                }}
                className={`flex h-[28px] w-full items-center justify-between gap-4 whitespace-nowrap px-[11px] text-left text-[12px] transition-colors hover:bg-[var(--p-hover)] ${
                  on ? 'text-[var(--p-accent-hi)]' : 'text-[var(--p-text-soft)] hover:text-[var(--p-text)]'
                }`}
                style={o.style}
              >
                {o.name}
                {on && (
                  <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M4.5 12.5l5 5 10-11" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * RESET, as Prism's own settings draw it (owner, 2026-09-22: "don't show these
 * buttons, use instead the same as Prism uses in style where it is just a
 * simple reset text you can click"): a word in the accent, underlined on hover,
 * beside the colour it puts back. For a row whose value can return to what
 * the theme gives it.
 */
export const RESET_LINK =
  'text-[11px] font-semibold text-[var(--p-accent-hi)] hover:underline focus-visible:underline focus-visible:outline-none'

/**
 * SETTINGS CONTROLS ARE NEUTRAL, AND ONLY SAVE WEARS THE ACCENT (owner,
 * 2026-09-23: "i dont want settings buttons to be affected by the accent
 * colour... grey based on the bg colour and then a slight contrast so that it
 * can easily be seen. same colours as the drop down menus"; "the only ones to
 * keep accented are the save buttons"). Every grey here is a token the theme
 * derives from its own ground, so it keeps its contrast on every preset and on
 * a chosen background. The focus ring stays the accent: it is not a button.
 * Since #138 (2026-10-07) an ON switch is the exception, below.
 */

/** The button a row uses for a verb of its own: the dropdown's own look. */
export const ROW_BUTTON =
  'h-8 rounded-[var(--p-radius-sm)] border border-[color:var(--p-divider)] bg-[var(--p-control)] px-3 text-[12px] font-semibold text-[var(--p-text)] transition-colors hover:border-[color:var(--p-line)] hover:bg-[var(--p-hover)] focus-visible:border-[var(--p-accent-hi)] focus-visible:outline-none disabled:opacity-50'

/** The pressed segment: a step lighter than the control round it (darker on a
 *  light theme), in the text's own ink. */
// The host may say how a pressed segment reads (Prism Terminal, 2026-10-12: a
// dark pill with light ink on a light theme, where a 16 percent grey on a pale
// control was "a very light gray color for buttons"); unset, the grey as before.
export const SEGMENT_ON =
  'bg-[var(--p-pressed,color-mix(in_srgb,var(--p-text)_16%,var(--p-control)))] text-[var(--p-pressed-ink,var(--p-text))]'

/**
 * A switch that is on WEARS THE THEME'S ACCENT (#138; owner, 2026-10-07:
 * "toggles differ in look i like the teal with black not the green and
 * white", then "yes option 1 but it should depend on the theme so only teal on
 * the teal theme"). This narrows #42 for the switch alone: row buttons and
 * segments stay grey. The track is `--p-sel-bg`, the accent as a FILL, which
 * both apps move until `--p-on-accent` clears 4.5:1 on it (the update chip's
 * own pair); the raw accent is only held to 3:1, and a see-through accent's
 * fill is flattened under glass. The KNOB follows the theme, not the accent
 * (owner, 2026-10-10: "keep that to being black on dark themes and white on
 * light themes ... only when the color is very close"): `--p-switch-knob`,
 * black on a dark ground and white on a light one, the opposite only where
 * that reads under 2:1 on the track (`lib/switchKnob.ts`). A host that does
 * not define it yet (Prism) keeps `--p-on-accent`. Hovered it lifts like Save;
 * disabled it is dimmed, so a switch nobody can change does not shout the
 * accent. Off is the grey track and white knob it always was, and keyboard
 * focus stays the row's fill (Prism #272: never a ring).
 */
export const SWITCH_ON = 'bg-[var(--p-sel-bg)] enabled:hover:brightness-110 disabled:opacity-50'
export const SWITCH_KNOB_ON = 'bg-[var(--p-switch-knob,var(--p-on-accent))]'

