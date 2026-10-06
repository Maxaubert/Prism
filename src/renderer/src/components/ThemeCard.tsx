import { forwardRef, useMemo, type CSSProperties, type JSX, type KeyboardEvent, type MouseEvent } from 'react'
import { Glyph } from 'prism-term-core/renderer/settings/layout/Glyph'
import { type Style } from '../lib/theme'
import { FrostBackdrop } from './FrostBackdrop'
import { miniLook } from '../lib/themes/miniLook'
import { StyleMini } from './StyleMini'
import { CARD_BOX, CARD_BOX_HI, CARD_TEXT, cardCheck } from '../lib/themes/cardBox'

/**
 * ONE THEME ON THE WALL, CARD STYLE B (owner, 2026-10-06, of three in the
 * approved mockup): the mini Explorer with the name on a 28px band at its
 * foot. The band and a 2px frame round the preview are the CARD, one dark
 * grey for every theme (`lib/themes/cardBox.ts`; owner, the same day: "give
 * all the same coloured box for the card"); only the preview wears the
 * theme. The chosen card wears a 2px ring in the window's accent line, 2px
 * outside the box, and a check in the band in the theme's own accent where
 * that reads on the grey: a selection MARK, so it keeps the accent (#202). The theme's description is the tooltip; nothing says
 * "Suggested" in the app, all 18 are simply themes.
 *
 * Focus is #272's: no ring and no outline. The base layer lays the hover
 * fill on a focused `[role='radio']`, which shows in the card's 4px margin
 * round the preview, and the grey frame goes a step lighter.
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
          '--mini-edge': CARD_BOX,
          '--mini-edge-hi': CARD_BOX_HI
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
          style={{ background: CARD_BOX, color: CARD_TEXT }}
        >
          <span className="min-w-0 flex-1 truncate">{st.name}</span>
          {chosen && (
            <svg
              data-theme-check=""
              viewBox="0 0 24 24"
              width={13}
              height={13}
              fill="none"
              stroke={cardCheck(look.accent)}
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0"
            >
              <path d={CHECK} />
            </svg>
          )}
        </span>
        {/* The grey frame, over everything, the chosen card's too: the box
            is the card, and the ring sits outside it. */}
        <span className="theme-card-edge pointer-events-none absolute inset-0 z-[3] rounded-[inherit]" />
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
