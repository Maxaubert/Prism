import { useId, useLayoutEffect, useRef, type JSX, type MouseEvent, type ReactNode } from 'react'
import { Glyph } from './Glyph'

// ONE SETTING, AS A ROW OF A SECTION'S PANEL (2026-10-05, the grouped cards
// redesign): an icon tile, the label with ONE line of subtext under it, and
// the control at the right. A grid, so every label in a panel starts at the
// same x whatever its control is. The rows of a panel are ruled by a hairline
// that starts after the icon column; a full-width block is ruled edge to edge.

/** The hairline above every row or block but the first. A row after a full
 *  block starts its rule at the panel's edge too. */
export const RULE =
  "before:pointer-events-none before:absolute before:right-0 before:top-0 before:h-px before:bg-[var(--p-line)] before:content-[''] first:before:hidden"

/**
 * KEYBOARD FOCUS IS A FILL, NEVER A RING (Prism #272; owner, 2026-10-05, Q1:
 * both apps). A row holding the focus takes the hover fill, and a bordered
 * control in it shows the focus as its edge a step lighter, never the accent.
 * The colour field keeps its own focus look (the picker is unchanged).
 *
 * THE DROPDOWN'S MENU BLURS WHAT IS BEHIND IT AND CASTS NO SHADOW (owner's
 * popup rule, 2026-09-22), here, on the row.
 */
export const ROW_SCOPE =
  'has-[:focus-visible]:bg-[var(--p-hover)] ' +
  '[&_button:not([data-colour-swatch]):focus-visible]:border-[color:color-mix(in_srgb,var(--p-text)_22%,transparent)] ' +
  '[&_[role=listbox]]:rounded-[7px] [&_[role=listbox]]:border-[color:var(--p-line)] [&_[role=listbox]]:bg-[color-mix(in_srgb,var(--p-side-flat)_80%,transparent)] [&_[role=listbox]]:shadow-none [&_[role=listbox]]:backdrop-blur-[22px] [&_[role=listbox]]:backdrop-saturate-[1.3]'

/** A subtext's ink: the dim ink a step towards the text, so it holds 4.5:1
 *  on the panel as composited over a LIGHT ground too (MEASURED in
 *  `settingsLook`: the bare dim ink read 3.9:1 on Paper's panel). */
export const SUB_INK = 'text-[color-mix(in_srgb,var(--p-dim)_72%,var(--p-text))]'

/** A warning subtext's ink: the mockup's amber on a dark ground, a deeper
 *  amber on a light one, so it holds 4.5:1 on both (MEASURED in
 *  `settingsLook`; one mix for both read 4.0:1 on Paper). `light-dark()`
 *  follows the colour scheme the host sets from its ground. */
export const WARN_INK =
  'text-[light-dark(color-mix(in_srgb,#a46400_75%,var(--p-text)),color-mix(in_srgb,#e0a84b_85%,var(--p-text)))]'

/** The icon tile, 32px, its corner a step under the panel's. */
export function IconTile({ icon }: { icon: string }): JSX.Element {
  return (
    <div className="grid h-8 w-8 place-items-center rounded-[max(4px,calc(var(--p-radius)_-_1px))] bg-[color-mix(in_srgb,var(--p-text)_6%,transparent)] text-[var(--p-text-soft)]">
      <Glyph name={icon} />
    </div>
  )
}

/** The subtext: one line, truncated, the whole text on its tooltip. */
export function Subtext({ id, text, warn }: { id?: string; text: string; warn?: boolean }): JSX.Element {
  return (
    <div
      id={id}
      title={text}
      className={`mt-0.5 truncate text-[11.5px] leading-[1.35] ${warn ? WARN_INK : SUB_INK}`}
    >
      {warn && (
        <span className="mr-1 inline-block align-[-1.5px]">
          <Glyph name="warn" size={11} stroke={2.2} />
        </span>
      )}
      {text}
    </div>
  )
}

export function SettingRow({
  id,
  icon,
  label,
  sub,
  warn,
  off,
  tap,
  children
}: {
  /** `data-pref`, and the id of the control the label names. */
  id: string
  icon: string
  label: string
  sub?: string
  /** The subtext is a warning: amber, with a mark. */
  warn?: boolean
  /** Cannot be used now: dimmed, not clickable, `aria-disabled`. */
  off?: boolean
  /** The control is a switch: a press anywhere on the row flips it. */
  tap?: boolean
  children: ReactNode
}): JSX.Element {
  const subId = useId()
  const box = useRef<HTMLDivElement>(null)
  // Every control is DESCRIBED by the subtext, so a screen reader hears the
  // live state ("Needs a speech model before it works.") with the control.
  useLayoutEffect(() => {
    const ctl = box.current?.querySelector('[data-row-control]')
    if (!ctl) return
    for (const el of ctl.querySelectorAll('button:not([role="option"]), input')) {
      if (sub) el.setAttribute('aria-describedby', subId)
      else el.removeAttribute('aria-describedby')
    }
  })
  const flip = (e: MouseEvent): void => {
    if (!tap || off) return
    if ((e.target as Element).closest('button, input, a, [role="listbox"], [data-row-control] *')) return
    box.current?.querySelector<HTMLButtonElement>('[role="switch"]:not(:disabled)')?.click()
  }
  const dim = off ? 'pointer-events-none opacity-[.45]' : ''
  return (
    <div
      ref={box}
      data-pref={id}
      data-setting-row
      aria-disabled={off || undefined}
      onClick={tap ? flip : undefined}
      className={`relative grid min-h-[58px] grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-x-3.5 py-2.5 pl-3.5 pr-4 first:rounded-t-[inherit] last:rounded-b-[inherit] ${RULE} before:left-[60px] [[data-full]+&]:before:left-0 ${ROW_SCOPE} ${
        tap && !off ? 'cursor-pointer hover:bg-[color-mix(in_srgb,var(--p-text)_2.5%,transparent)]' : ''
      }`}
    >
      <div className={dim}>
        <IconTile icon={icon} />
      </div>
      <div className={`min-w-0 ${dim}`}>
        <label htmlFor={id} className="block text-[13px] font-semibold leading-[1.3] text-[var(--p-text)]">
          {label}
        </label>
        {sub && <Subtext id={subId} text={sub} warn={warn} />}
      </div>
      {/* A group named by the row's label: a segmented control's buttons are
          named by their options alone ("Dynamic"), so without this a screen
          reader never hears which setting they belong to (spec 1.3). */}
      <div
        data-row-control
        role="group"
        aria-label={label}
        className={`flex items-center justify-end gap-2.5 justify-self-end ${dim}`}
      >
        {children}
      </div>
    </div>
  )
}
