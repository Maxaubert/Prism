import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { createPortal } from 'react-dom'
import {
  alphaPct,
  snapAlphaStep,
  colourCommit,
  fitAlpha,
  format,
  hsvToRgb,
  parseColour,
  rgbToHsv,
  toStored,
  type AlphaRange,
  type Hsva,
  type Rgba,
  clamp
} from '../lib/colour'
import { cycleColourFormat, useColourFormat } from '../lib/colourFormat'
import { ROW_BUTTON } from './fields'
import { LAYER } from '../components/layers'

// ONE COLOUR PICKER, WITH ALPHA, FOR EVERY COLOUR IN BOTH APPS (#112; owner,
// 2026-10-03: "the colour pickers should be the same for both apps, i need an
// input field for a color code and an alpha per colour on every colour
// setting"). Spec: docs/superpowers/specs/2026-10-03-colour-picker-alpha-design.md.
//
// Props only. The row shows a code field (HEX, RGBA or HSLA, any of them
// typed) and a swatch; the swatch opens a popover with a saturation and
// brightness square, a hue bar, an alpha bar, an eyedropper, the colour it
// opened with beside the new one, and the format toggle. The native
// <input type=color> is gone: it cannot carry an alpha.
//
// THE DOM CONTRACT, which both apps' e2e are written against (Prism's gate
// before this file existed), so these names are fixed by the spec:
//   - the code field: the row's only <input> with no `type`, aria-label =
//     `label`, its value in HEX the lower-case stored form;
//   - the swatch: <button aria-label="Pick <label>" data-colour-swatch>;
//   - the popover: [data-colour-popover][role="dialog"], aria-label = `label`;
//   - the sliders: [role="slider"] named exactly "Saturation and brightness",
//     "Hue" and "Alpha"; the alpha's aria-valuenow is whole percent;
//   - the format toggle: button[data-colour-format], text HEX, RGBA or HSLA;
//   - the eyedropper: button[data-colour-eyedropper].

export interface ColourFieldProps extends AlphaRange {
  /** The code field's and the popover's aria-label, as it is. */
  label: string
  /** The colour in force: a stored form, or anything parseable. */
  value: string
  /** Always the stored form: `#rrggbb` when opaque, `#rrggbbaa` otherwise. */
  onChange: (stored: string) => void
  /**
   * Escape after the popover wrote: put back the row's stored state as it was
   * when the popover OPENED, an unset state included (a row that followed the
   * theme follows it again). The function given at the moment the popover
   * opens is the one called, so a closure over that render's state is right.
   * Absent: the opening value is written back in one onChange.
   */
  onRevert?: () => void
  /** Optional quantiser for the alpha (Prism Primary's glass range). */
  snapAlpha?: (a: number) => number
  /** The alpha bar shows, faded and inert (acrylic off). */
  alphaDisabled?: boolean
  /** For a <label htmlFor>. */
  id?: string
}

const MONO = "font-[Consolas,'Cascadia_Mono',monospace]"
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--p-accent-hi)]'
/** The checkerboard a see-through colour is drawn over: a convention, so the
 *  same greys on every theme. */
const CHECKER: CSSProperties = {
  backgroundImage: 'repeating-conic-gradient(#c4c4c4 0 25%, #f4f4f4 0 50%)',
  backgroundSize: '8px 8px'
}
const SQUARE_W = 200
const SQUARE_H = 140
const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 }

const css = (c: Rgba): string => toStored(c)
const solid = (c: Rgba): string => toStored({ ...c, a: 1 })

/** A swatch: the colour over the checkerboard, the left half solid and the
 *  right half at its alpha, so a see-through colour is seen at a glance. */
function Chip({ colour, className = '' }: { colour: Rgba; className?: string }): JSX.Element {
  return (
    <span className={`relative block overflow-hidden ${className}`} style={CHECKER} aria-hidden>
      <span className="absolute inset-y-0 left-0 w-1/2" style={{ background: solid(colour) }} />
      <span className="absolute inset-y-0 right-0 w-1/2" style={{ background: css(colour) }} />
    </span>
  )
}

/** The row control: the code field and the swatch that opens the picker. */
export function ColourField({
  label,
  value,
  onChange,
  onRevert,
  alpha = true,
  alphaMin = 0,
  alphaMax = 1,
  snapAlpha,
  alphaDisabled,
  id
}: ColourFieldProps): JSX.Element {
  const range: AlphaRange = { alpha, alphaMin, alphaMax }
  const fmt = useColourFormat()
  const parsed = parseColour(value)
  const shown = parsed ? fitAlpha(parsed, range) : null
  // While you are typing the field holds the draft; the rest of the time it is
  // simply the colour, so half-typed values never repaint the app.
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? (shown ? format(shown, fmt) : value)
  const commit = (): void => {
    setDraft(null) // either it took, or the field goes back to the colour
    let next = colourCommit(draft, value, range)
    if (next && snapAlpha && alpha) {
      const p = parseColour(next)!
      next = toStored({ ...p, a: snapAlpha(p.a) })
      if (parsed && next === toStored(fitAlpha(parsed, range))) next = null
    }
    if (next) onChange(next)
  }
  const swatch = useRef<HTMLButtonElement>(null)
  // What the popover opened with, and the revert in force at that moment.
  const [open, setOpen] = useState<{ value: string; revert?: () => void; anchor: HTMLElement } | null>(null)
  return (
    <span className="flex items-center gap-1.5">
      <input
        id={id}
        value={text}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          else if (e.key === 'Escape' && draft !== null) {
            // A draft is dropped; with none, Escape is whoever's it was.
            e.stopPropagation()
            setDraft(null)
          }
        }}
        spellCheck={false}
        aria-label={label}
        style={{ width: fmt === 'hex' ? 76 : 172 }}
        className={`rounded-[var(--p-radius-sm)] border border-[color:var(--p-line)] bg-[var(--p-control)] px-1 py-0.5 text-center ${MONO} text-[10.5px] text-[var(--p-text)] focus-visible:border-[var(--p-accent-hi)] focus-visible:outline-none ${
          fmt === 'hex' && draft === null ? 'uppercase' : ''
        }`}
      />
      <button
        ref={swatch}
        type="button"
        data-colour-swatch
        aria-label={`Pick ${label}`}
        aria-haspopup="dialog"
        aria-expanded={open !== null}
        title="Pick a colour"
        onClick={(e) => {
          const anchor = e.currentTarget
          setOpen((o) => (o ? null : { value: shown ? toStored(shown) : value, revert: onRevert, anchor }))
        }}
        className={`block h-6 w-9 shrink-0 overflow-hidden rounded-[var(--p-radius-sm)] border border-[color:var(--p-line)] ${FOCUS}`}
      >
        <Chip colour={shown ?? BLACK} className="h-full w-full" />
      </button>
      {open && (
        <ColourPopover
          label={label}
          anchor={open.anchor}
          opened={open.value}
          onChange={onChange}
          onRevert={open.revert}
          alpha={alpha}
          alphaMin={alphaMin}
          alphaMax={alphaMax}
          snapAlpha={snapAlpha}
          alphaDisabled={alphaDisabled}
          onClose={(focusSwatch) => {
            setOpen(null)
            if (focusSwatch) swatch.current?.focus()
          }}
        />
      )}
    </span>
  )
}

/** The eyedropper is Chromium's (`EyeDropper`, in Electron 43). There is no
 *  probe: open() needs a user gesture and shows the dropper, so it cannot be
 *  tried silently. A real press that fails with anything but the user's own
 *  cancel hides the button for the rest of the session. */
let dropperBroken = false
interface EyeDropperLike {
  open(): Promise<{ sRGBHex: string }>
}
const dropperCtor = (): (new () => EyeDropperLike) | null =>
  !dropperBroken && typeof window !== 'undefined' && 'EyeDropper' in window
    ? ((window as unknown as { EyeDropper: new () => EyeDropperLike }).EyeDropper)
    : null

/** The keys the popover answers; none of them reaches an ancestor. */
const OWN_KEYS = new Set(['Escape', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', ' '])

export function ColourPopover({
  label,
  anchor,
  opened,
  onChange,
  onRevert,
  alpha = true,
  alphaMin = 0,
  alphaMax = 1,
  snapAlpha,
  alphaDisabled,
  onClose
}: AlphaRange & {
  label: string
  anchor: HTMLElement
  /** The stored colour the popover opened with. */
  opened: string
  onChange: (stored: string) => void
  onRevert?: () => void
  snapAlpha?: (a: number) => number
  alphaDisabled?: boolean
  /** `focusSwatch`: give the keyboard back to the swatch. */
  onClose: (focusSwatch: boolean) => void
}): JSX.Element {
  const range: AlphaRange = { alpha, alphaMin, alphaMax }
  const start = fitAlpha(parseColour(opened) ?? BLACK, range)
  // The picker holds HSV, not the stored colour: a grey has no hue, and a hue
  // dragged to while the colour is grey must not be lost on the next frame.
  const [hsv, setHsv] = useState<Hsva>(() => rgbToHsv(start))
  const [, setDropper] = useState(0)
  const fmt = useColourFormat()
  const root = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // LIVE, one write per frame while a pointer drags; a key writes at once.
  const latest = useRef({ onChange, onClose })
  useEffect(() => {
    latest.current = { onChange, onClose }
  })
  const wrote = useRef(false)
  const lastSent = useRef(toStored(start))
  const pending = useRef<string | null>(null)
  const frame = useRef<number | null>(null)
  const send = (stored: string): void => {
    if (stored === lastSent.current) return
    lastSent.current = stored
    wrote.current = true
    latest.current.onChange(stored)
  }
  const flush = (): void => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    if (pending.current !== null) send(pending.current)
    pending.current = null
  }
  const storedOf = (c: Hsva): string => {
    const rgb = fitAlpha(hsvToRgb(c), range)
    return toStored(alpha && snapAlpha ? { ...rgb, a: snapAlpha(rgb.a) } : rgb)
  }
  const set = (next: Hsva, now: boolean): void => {
    setHsv(next)
    pending.current = storedOf(next)
    if (now) flush()
    else if (frame.current === null) frame.current = requestAnimationFrame(flush)
  }

  // Closing keeps the colour (outside press, focus elsewhere); Escape undoes.
  const close = useCallback((focusSwatch: boolean): void => {
    flush()
    latest.current.onClose(focusSwatch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const cancel = (): void => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    pending.current = null
    if (wrote.current) {
      if (onRevert) onRevert()
      else latest.current.onChange(toStored(start))
    }
    latest.current.onClose(true)
  }

  // Under the swatch, or above it when there is no room below; inside the
  // window either way. Placed again when the format changes: every code field
  // widens with it (76px to 172px), and in the theme editor's grid that moves
  // every swatch, this one included (#113 review).
  useLayoutEffect(() => {
    const place = (): void => {
      const box = root.current
      if (!box) return
      const a = anchor.getBoundingClientRect()
      const w = box.offsetWidth
      const h = box.offsetHeight
      const left = clamp(a.right - w, 8, window.innerWidth - w - 8)
      const below = a.bottom + 6
      const top = below + h <= window.innerHeight - 8 ? below : Math.max(8, a.top - h - 6)
      setPos({ left, top })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor, fmt])

  // The keyboard goes in with it, to the square.
  useEffect(() => {
    root.current?.querySelector<HTMLElement>('[role="slider"]')?.focus()
  }, [])

  // A press outside keeps the colour and closes; the swatch is the toggle.
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Node
      if (root.current?.contains(t) || anchor.contains(t)) return
      close(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    }
  }, [anchor, close])

  const onKeyDown = (e: ReactKeyboardEvent): void => {
    if (!OWN_KEYS.has(e.key)) return
    // React ancestors see portal events through the React tree; none of them
    // hears a key the popover answers. (Window listeners are native and run
    // first: each checks for [data-colour-popover] itself.)
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    } else if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      // Tab stays inside, as in the theme editor; Ctrl+Tab is the app's.
      const all = [...(root.current?.querySelectorAll<HTMLElement>('button, [tabindex="0"]') ?? [])].filter(
        (el) => !el.hasAttribute('disabled')
      )
      if (!all.length) return
      const i = all.indexOf(document.activeElement as HTMLElement)
      const next = e.shiftKey ? (i <= 0 ? all.length - 1 : i - 1) : i === -1 || i === all.length - 1 ? 0 : i + 1
      e.preventDefault()
      all[next].focus()
    }
  }

  const rgb = hsvToRgb(hsv)
  const now = fitAlpha(rgb, range)
  const Dropper = dropperCtor()
  const pick = (): void => {
    if (!Dropper) return
    new Dropper()
      .open()
      .then(({ sRGBHex }) => {
        const c = parseColour(sRGBHex)
        // The RGB is the screen's; the alpha stays the colour's own.
        if (c) set({ ...rgbToHsv({ ...c, a: 1 }), a: hsv.a }, true)
      })
      .catch((err: unknown) => {
        if ((err as { name?: string } | null)?.name !== 'AbortError') {
          dropperBroken = true
          setDropper((n) => n + 1)
        }
      })
  }
  const target = anchor.closest<HTMLElement>('[aria-modal="true"]') ?? document.body
  return createPortal(
    <div
      ref={root}
      data-colour-popover
      data-owns-escape
      role="dialog"
      aria-label={label}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        // The focus went to something else in the window: a layer that takes
        // it as it opens (Command help, the update window, a close question)
        // or a shell. Leaving with the window itself (no relatedTarget) is
        // not leaving the picker.
        const to = e.relatedTarget as Node | null
        if (to && !root.current?.contains(to) && !anchor.contains(to)) close(false)
      }}
      onMouseDown={(e) => {
        // A press on the popover's own ground is not a press elsewhere: it
        // must not take the focus out of it.
        if (!(e.target as HTMLElement).closest('button, [tabindex="0"]')) e.preventDefault()
      }}
      // Under the update window, Command help and a close question (z-50),
      // over a settings page; inside the theme editor, over its panel.
      className={`fixed ${target === document.body ? LAYER.picker : 'z-10'} w-[226px] rounded-md border border-[color:var(--p-divider)] bg-[var(--p-side-flat)] p-3 shadow-[0_10px_28px_rgba(0,0,0,.5)]`}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}
    >
      <SvSquare hsv={hsv} onChange={set} />
      <HueBar hsv={hsv} onChange={set} />
      {alpha && (
        <AlphaBar
          hsv={hsv}
          min={alphaMin}
          max={alphaMax}
          disabled={!!alphaDisabled}
          snap={snapAlpha}
          onChange={set}
        />
      )}
      <div className="mt-3 flex items-center gap-2">
        {Dropper && (
          <button
            type="button"
            data-colour-eyedropper
            aria-label="Pick a colour from the screen"
            title="Pick a colour from the screen"
            onClick={pick}
            className={`${ROW_BUTTON} grid h-7 w-7 shrink-0 place-items-center !px-0`}
          >
            <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M14.5 5.5l4 4M17 3a2.1 2.1 0 013 3l-2.5 2.5-3-3zM14.5 7.5L5 17v2h2l9.5-9.5" />
            </svg>
          </button>
        )}
        <span className="flex h-7 flex-1 overflow-hidden rounded-[var(--p-radius-sm)] border border-[color:var(--p-line)]" title="Before and after">
          <span className="relative flex-1" style={CHECKER}>
            <span className="absolute inset-0" style={{ background: css(start) }} />
          </span>
          <span className="relative flex-1" style={CHECKER}>
            <span className="absolute inset-0" style={{ background: css(now) }} />
          </span>
        </span>
        <button
          type="button"
          data-colour-format
          title="How colour codes are written"
          onClick={() => cycleColourFormat()}
          className={`${ROW_BUTTON} !h-7 w-[54px] shrink-0 !px-0 ${MONO} !text-[11px]`}
        >
          {fmt.toUpperCase()}
        </button>
      </div>
    </div>,
    target
  )
}

/** A pointer drag over `el`, reporting the pointer as 0..1 on each axis. */
function useDrag(onMove: (x: number, y: number) => void, disabled = false) {
  const move = useRef(onMove)
  useEffect(() => {
    move.current = onMove
  })
  const at = (e: ReactPointerEvent<HTMLElement>): void => {
    const r = e.currentTarget.getBoundingClientRect()
    move.current(clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1))
  }
  return {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>): void => {
      if (disabled || e.button !== 0) return
      e.currentTarget.setPointerCapture(e.pointerId)
      e.currentTarget.focus()
      at(e)
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>): void => {
      if (!disabled && e.currentTarget.hasPointerCapture(e.pointerId)) at(e)
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>): void => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }
}

/** Arrows step by 1, Shift by 10. */
const step = (e: ReactKeyboardEvent): number => (e.shiftKey ? 10 : 1)

/** A thumb: ink with a ring of the ground, so it reads on any colour. Never
 *  the accent (#42): settings controls stay neutral. */
const THUMB =
  'pointer-events-none absolute rounded-full border-2 border-[var(--p-text)] shadow-[0_0_0_1.5px_var(--p-bg)]'

type SetHsv = (next: Hsva, now: boolean) => void

export function SvSquare({ hsv, onChange }: { hsv: Hsva; onChange: SetHsv }): JSX.Element {
  const drag = useDrag((x, y) => onChange({ ...hsv, s: x * 100, v: (1 - y) * 100 }, false))
  const hue = solid(hsvToRgb({ h: hsv.h, s: 100, v: 100, a: 1 }))
  const s = Math.round(hsv.s)
  const v = Math.round(hsv.v)
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Saturation and brightness"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={s}
      aria-valuetext={`saturation ${s} percent, brightness ${v} percent`}
      {...drag}
      onKeyDown={(e) => {
        const d = step(e)
        const keys: Record<string, Partial<Hsva>> = {
          ArrowLeft: { s: clamp(s - d, 0, 100) },
          ArrowRight: { s: clamp(s + d, 0, 100) },
          ArrowDown: { v: clamp(v - d, 0, 100) },
          ArrowUp: { v: clamp(v + d, 0, 100) }
        }
        const k = keys[e.key]
        if (!k) return
        e.preventDefault()
        onChange({ ...hsv, ...k }, true)
      }}
      className={`relative cursor-crosshair touch-none rounded-[var(--p-radius-sm)] ${FOCUS}`}
      style={{
        width: SQUARE_W,
        height: SQUARE_H,
        background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hue})`
      }}
    >
      <span
        className={`${THUMB} h-3.5 w-3.5 -translate-x-1/2 translate-y-1/2`}
        style={{ left: `${hsv.s}%`, bottom: `${hsv.v}%`, background: solid(hsvToRgb(hsv)) }}
      />
    </div>
  )
}

const HUES = 'linear-gradient(to right, #f00 0%, #ff0 16.67%, #0f0 33.33%, #0ff 50%, #00f 66.67%, #f0f 83.33%, #f00 100%)'

/** A horizontal bar with one thumb: the hue and the alpha. */
function Bar({
  label,
  value,
  now,
  min,
  max,
  text,
  disabled,
  background,
  checker,
  onValue
}: {
  label: string
  value: number
  /** What aria-valuenow says, in whole steps. */
  now: number
  min: number
  max: number
  text: string
  disabled?: boolean
  background: string
  checker?: boolean
  onValue: (v: number, now: boolean) => void
}): JSX.Element {
  const drag = useDrag((x) => onValue(x * 100, false), disabled)
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={now}
      aria-valuetext={text}
      aria-disabled={disabled || undefined}
      {...drag}
      onKeyDown={(e) => {
        if (disabled) return
        const d = step(e)
        const v = Math.round(value)
        const next =
          e.key === 'ArrowLeft' || e.key === 'ArrowDown'
            ? v - d
            : e.key === 'ArrowRight' || e.key === 'ArrowUp'
              ? v + d
              : e.key === 'Home'
                ? min
                : e.key === 'End'
                  ? max
                  : null
        if (next === null) return
        e.preventDefault()
        onValue(next, true)
      }}
      className={`relative mt-3 h-3 touch-none rounded-full ${disabled ? 'cursor-default opacity-40' : 'cursor-pointer'} ${FOCUS}`}
      style={{ width: SQUARE_W, ...(checker ? CHECKER : {}) }}
    >
      <span className="absolute inset-0 rounded-full" style={{ background }} />
      <span
        className={`${THUMB} top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2`}
        style={{ left: `${((value - 0) / 100) * 100}%` }}
      />
    </div>
  )
}

export function HueBar({ hsv, onChange }: { hsv: Hsva; onChange: SetHsv }): JSX.Element {
  // The bar runs 0..100 under the pointer; the slider speaks degrees.
  return (
    <HueSlider
      hue={hsv.h}
      onHue={(h, now) => onChange({ ...hsv, h }, now)}
    />
  )
}

function HueSlider({ hue, onHue }: { hue: number; onHue: (h: number, now: boolean) => void }): JSX.Element {
  const drag = useDrag((x) => onHue(x * 360, false))
  const h = Math.round(hue)
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Hue"
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={h}
      aria-valuetext={`${h} degrees`}
      {...drag}
      onKeyDown={(e) => {
        const d = step(e)
        const next =
          e.key === 'ArrowLeft' || e.key === 'ArrowDown'
            ? h - d
            : e.key === 'ArrowRight' || e.key === 'ArrowUp'
              ? h + d
              : e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? 360
                  : null
        if (next === null) return
        e.preventDefault()
        onHue(clamp(next, 0, 360), true)
      }}
      className={`relative mt-3 h-3 cursor-pointer touch-none rounded-full ${FOCUS}`}
      style={{ width: SQUARE_W, background: HUES }}
    >
      <span className={`${THUMB} top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2`} style={{ left: `${(hue / 360) * 100}%` }} />
    </div>
  )
}

export function AlphaBar({
  hsv,
  min = 0,
  max = 1,
  disabled,
  snap,
  onChange
}: {
  hsv: Hsva
  min?: number
  max?: number
  disabled?: boolean
  /** The host's own steps (Prism's glass levels): the bar shows and says the
   *  alpha that will be STORED, and a key press always reaches the next one. */
  snap?: (a: number) => number
  onChange: SetHsv
}): JSX.Element {
  const colour = solid(hsvToRgb(hsv))
  const pct = hsv.a * 100
  return (
    <Bar
      label="Alpha"
      value={pct}
      now={alphaPct(hsv.a)}
      min={alphaPct(min)}
      max={alphaPct(max)}
      text={`${alphaPct(hsv.a)} percent opaque`}
      disabled={disabled}
      checker
      background={`linear-gradient(to right, ${colour}00, ${colour})`}
      onValue={(v, now) => onChange({ ...hsv, a: snapAlphaStep(v / 100, hsv.a, now, { min, max, snap }) }, now)}
    />
  )
}
