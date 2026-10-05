import type { JSX, ReactNode } from 'react'

// THE PICKER CARDS of Prism's own walls: the styles, the visualizer's presets,
// the progress bar's styles. A card is a selection mark, not a button, so the
// chosen one keeps the accent (#202: "selection marks ... keep the accent").

/** A wall of cards, as the v1 mockup draws it (2026-10-05): the track flexes
 *  from 124px and a row drops a column only when it runs out of room. The
 *  cap on the CARD keeps three cards from stretching across a wide window
 *  (with two definite lengths auto-fill counts columns by the max, so the
 *  cap cannot live on the track). */
export const CARD_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(124px,1fr))] gap-2.5 [&>*]:max-w-[220px]'

/** A sub-heading inside a block ("Solid", "Line"): words, not a section. */
export function BlockLabel({ children }: { children: ReactNode }): JSX.Element {
  return <div className="mx-0.5 mb-2 mt-0.5 text-[11.5px] font-semibold text-[var(--p-dim)]">{children}</div>
}

/** A selectable card. A div rather than a button so a card can carry its own
 *  controls (a preset's delete). */
export function Tile({
  on,
  onClick,
  children
}: {
  on: boolean
  onClick: () => void
  children: ReactNode
}): JSX.Element {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={on}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      // The chosen card's wash is from the accent as picked, so the accent's
      // alpha (a choice about fills) never fades the mark that says "this one".
      className={`group relative flex cursor-pointer flex-col gap-[7px] rounded-[var(--p-radius)] border p-[7px] text-left transition ${
        on
          ? 'border-[var(--p-accent-solid)] bg-[var(--p-accent-solid)]/12 shadow-[0_0_0_2px_var(--p-accent-solid)]'
          : 'border-[color:var(--p-divider)] bg-[var(--p-hover)] hover:border-[color:var(--p-dim2)]'
      }`}
    >
      {children}
    </div>
  )
}

/** The card's name, and nothing else: the ring already says which card is
 *  chosen, so a "Selected" caption is the same fact written twice. */
export function TileFooter({ name, on }: { name: string; on: boolean }): JSX.Element {
  return (
    <span className={`truncate px-0.5 text-[12px] font-semibold ${on ? 'text-[var(--p-text)]' : 'text-[var(--p-text-soft)]'}`}>
      {name}
    </span>
  )
}
