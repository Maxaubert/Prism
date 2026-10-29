import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import { clipboardText } from '../../lib/clipboardText'
import { dialogButton } from '../dialogLook'
import { CheckGlyph, CopyGlyph } from '../icons/propertyGlyphs'
import { hiddenTitle } from 'prism-term-core/renderer/lib/hiddenTitle'

// The Properties window's pieces, shared by every kind (owner, 2026-10-12;
// the approved mockup `research/prism/mockups/2026-10-12-properties/final`):
// a header, label/value facts optionally under a small group heading, and a
// footer. Sizes are the mockup's, which are Prism's dialog's.

export interface Fact {
  label: string
  value: ReactNode
}

/** An icon (or a picture), the name, and one dim line; maybe a button. */
export function Header({
  icon,
  iconColour,
  title,
  sub,
  trailing
}: {
  icon: ReactNode
  iconColour?: string
  title: string
  sub?: string
  trailing?: ReactNode
}): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <div
        className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-md bg-[var(--p-control)] text-[var(--p-dim)]"
        style={iconColour ? { color: iconColour } : undefined}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <Title text={title} />
        {sub && <Sub text={sub} />}
      </div>
      {trailing}
    </div>
  )
}

export function Title({ text, className = '' }: { text: string; className?: string }): JSX.Element {
  return (
    <h2 className={`truncate text-[14.5px] font-semibold text-[var(--p-text)] ${className}`} {...hiddenTitle(text)}>
      {text}
    </h2>
  )
}

export function Sub({ text }: { text: string }): JSX.Element {
  return (
    <div className="mt-0.5 select-text truncate tabular-nums text-[var(--p-dim)]" {...hiddenTitle(text)}>
      {text}
    </div>
  )
}

/** Label/value rows. `children` go after the rows (the checksum). */
export function Facts({
  rows,
  children,
  className = 'mt-3.5'
}: {
  rows: Fact[]
  children?: ReactNode
  className?: string
}): JSX.Element {
  return (
    <dl className={`grid grid-cols-[max-content_1fr] gap-x-[22px] gap-y-1.5 ${className}`}>
      {rows.map((r) => (
        <FactRow key={r.label} label={r.label}>
          {r.value}
        </FactRow>
      ))}
      {children}
    </dl>
  )
}

export function FactRow({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="contents">
      <dt className="text-[var(--p-dim)]">{label}</dt>
      <dd className="min-w-0 select-text tabular-nums text-[var(--p-text-soft)] [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

/** A small heading over its facts. A group with nothing to say is left out
 *  (spec: "A group with no facts is left out"). */
export function Group({ title, rows, children }: { title: string; rows?: Fact[]; children?: ReactNode }): JSX.Element | null {
  if (!rows?.length && !children) return null
  return (
    <section className="mt-4">
      <h3 className="text-[11.5px] font-semibold tracking-[.01em] text-[var(--p-dim2)]">{title}</h3>
      {rows?.length ? <Facts rows={rows} className="mt-1.5" /> : null}
      {children}
    </section>
  )
}

/** The window's picture across the top: a photo, or a film's frame with its
 *  length in a badge. Gone when it cannot be drawn. */
export function Banner({
  src,
  height,
  badge,
  onSize
}: {
  src: string
  height: number
  badge?: string
  onSize?: (width: number, height: number) => void
}): JSX.Element | null {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <div className="relative mb-3 overflow-hidden rounded-md bg-black" style={{ height }}>
      <img
        src={src}
        alt=""
        draggable={false}
        className="block h-full w-full object-cover"
        onLoad={(e) => onSize?.(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
        onError={() => setFailed(true)}
      />
      {badge && (
        <span className="absolute bottom-2 right-2 rounded bg-black/65 px-1.5 py-0.5 text-[11px] tabular-nums text-white">
          {badge}
        </span>
      )}
    </div>
  )
}

/** Copies `text`; the glyph turns into a tick for a moment once it has. The
 *  mockup's tick was green, a colour Prism has no token for, so it is the
 *  text colour on the hover fill, the mockup's "on" look. */
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return (
    <button
      type="button"
      title={copied ? 'Copied' : label}
      aria-label={label}
      data-props-copy
      data-copied={copied ? 'true' : undefined}
      onClick={() => {
        if (!clipboardText(text)) return
        setCopied(true)
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setCopied(false), 1500)
      }}
      className={`inline-grid h-[22px] w-[22px] shrink-0 place-items-center rounded align-middle transition-colors focus-visible:outline-none ${
        copied
          ? 'bg-[var(--p-hover-hi)] text-[var(--p-text)]'
          : 'text-[var(--p-dim)] hover:bg-[var(--p-hover-hi)] hover:text-[var(--p-text)]'
      }`}
    >
      {copied ? <CheckGlyph /> : <CopyGlyph />}
    </button>
  )
}

/** Close on the right, as the only button but on a drive (spec: "Close is
 *  the only button, except on a drive"). */
export function Footer({ onClose, left, extra }: { onClose: () => void; left?: ReactNode; extra?: ReactNode }): JSX.Element {
  return (
    <div className="mt-[18px] flex items-center justify-end gap-2">
      {left && <div className="mr-auto flex gap-2">{left}</div>}
      {extra}
      <button type="button" data-primary="true" onClick={onClose} className={dialogButton({ primary: true })}>
        Close
      </button>
    </div>
  )
}

/** A quiet button for the footer (Open, Disk Cleanup). */
export function FooterButton({ label, onClick, quiet }: { label: string; onClick: () => void; quiet?: boolean }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${dialogButton({})}${quiet ? ' !bg-transparent' : ''}`}
    >
      {label}
    </button>
  )
}

export function Reading(): JSX.Element {
  return <div className="mt-3.5 italic text-[var(--p-dim2)]">Reading…</div>
}
