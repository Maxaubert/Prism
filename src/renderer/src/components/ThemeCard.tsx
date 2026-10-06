import { forwardRef, useMemo, type CSSProperties, type JSX, type KeyboardEvent, type MouseEvent } from 'react'
import { Glyph } from 'prism-term-core/renderer/settings/layout/Glyph'
import { rgba, type Style } from '../lib/theme'
import { FrostBackdrop } from './FrostBackdrop'
import { miniLook } from '../lib/themes/miniLook'
import { StyleMini } from './StyleMini'

/**
 * ONE THEME ON THE WALL, CARD STYLE B (owner, 2026-10-06, of three in the
 * approved mockup): the mini Explorer with the name on a 28px band at its
 * foot, in the theme's own panel colour and text. The chosen card wears a
 * 2px ring in the window's accent line, 2px outside the preview, and a check
 * in the band in the theme's own accent: a selection MARK, so it keeps the
 * accent (#202). The theme's description is the tooltip; nothing says
 * "Suggested" in the app, all 18 are simply themes.
 *
 * Focus is #272's: no ring and no outline. The base layer lays the hover
 * fill on a focused `[role='radio']`, which shows in the card's 4px margin
 * round the preview, and the preview's own edge goes to its hover strength.
 */

const CHECK = 'M5 13l4 4L19 7'

export interface ThemeCardProps {
  st: Style
  chosen: boolean
  /** The wall's roving tab stop. */
  tabbable: boolean
  /** The preview's height: 104px on the Settings wall, 72px in onboarding. */
  height?: number
  hidden?: boolean
  onPick: (e: MouseEvent) => void
  onDelete?: () => void
  onKeyDown?: (e: KeyboardEvent<HTMLButtonElement>) => void
}

export const ThemeCard = forwardRef<HTMLButtonElement, ThemeCardProps>(function ThemeCard(
  { st, chosen, tabbable, height = 104, hidden, onPick, onDelete, onKeyDown },
  ref
): JSX.Element {
  const look = useMemo(() => miniLook(st), [st])
  const light = st.mode === 'light'
  // The preview's own edge sits ON TOP of it, so a light card on a light
  // page still has one; stronger on hover and on focus. High contrast's is
  // stronger still.
  const edge = st.hc ? 0.55 : light ? 0.13 : 0.11
  const edgeHi = st.hc ? 0.8 : light ? 0.26 : 0.24
  return (
    <button
      ref={ref}
      type="button"
      role="radio"
      aria-checked={chosen}
      aria-label={st.name}
      title={st.blurb}
      tabIndex={tabbable ? 0 : -1}
      data-theme-card={st.id}
      data-hid={hidden ? '' : undefined}
      onClick={onPick}
      onKeyDown={onKeyDown}
      className="theme-card group relative -m-1 flex min-w-0 flex-col rounded-[calc(var(--p-radius)+4px)] p-1 text-left"
      style={
        {
          '--mini-edge': rgba(st.text, edge),
          '--mini-edge-hi': rgba(st.text, edgeHi)
        } as CSSProperties
      }
    >
      <span
        aria-hidden
        className="theme-card-pv relative block overflow-hidden"
        style={{
          borderRadius: 'max(4px, calc(var(--p-radius) - 2px))',
          isolation: 'isolate',
          // The chosen ring: an outline, 2px out, so it never moves the card.
          outline: `2px solid ${chosen ? 'var(--p-accent-solid)' : 'transparent'}`,
          outlineOffset: 2,
          transition: 'outline-color .15s ease-out'
        }}
      >
        {look.frosted && <FrostBackdrop />}
        <StyleMini st={st} height={height} />
        <span
          className="relative z-[1] flex h-[28px] items-center gap-1.5 px-2.5 text-[11.5px] font-semibold"
          style={{ background: look.panel, color: look.text, boxShadow: `inset 0 1px 0 ${look.edge}` }}
        >
          <span className="min-w-0 flex-1 truncate">{st.name}</span>
          {chosen && (
            <svg
              data-theme-check=""
              viewBox="0 0 24 24"
              width={13}
              height={13}
              fill="none"
              stroke={look.accent}
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0"
            >
              <path d={CHECK} />
            </svg>
          )}
        </span>
        {/* The edge, over everything; gone on the chosen card, whose ring
            is the edge. */}
        {!chosen && <span className="theme-card-edge pointer-events-none absolute inset-0 z-[3] rounded-[inherit]" />}
      </span>
      {onDelete && (
        <span
          role="button"
          tabIndex={-1}
          aria-label={`Delete ${st.name}`}
          title="Delete this copy"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="absolute right-2 top-[22px] z-[4] grid h-5 w-5 place-items-center rounded-[var(--p-radius-sm)] text-[var(--p-dim2)] opacity-0 transition hover:text-[var(--p-text)] group-hover:opacity-100"
          style={{ backgroundColor: 'var(--p-raised)' }}
        >
          <Glyph name="x" size={13} stroke={2} />
        </span>
      )}
    </button>
  )
})
