import type { HTMLAttributes, JSX, ReactNode } from 'react'
import { hiddenTitle } from 'prism-term-core/renderer/lib/hiddenTitle'
import { TILE_PAD, type Rect } from '../../lib/gridLayout'
import { landingTile } from '../../lib/landingGrid'

/**
 * ONE TILE OF THE GRID (zoom steps 5 to 9, Stage 4, 2026-11-09; spec 4.6 and
 * 5.1): a square picture box with the file's name under it in two lines. The
 * tile owns no behaviour of its own. BrowseList builds the same handlers a row
 * has (press, drag, drop, double click, right-click) and hands them in, so a
 * tile and a row can never disagree about what a click does.
 *
 * `rect` is the cell in the layer's own coordinates (gridLayout.cellRect).
 * `media` is the picture box, drawn by the caller (a ThumbImage, or the kind
 * icon on the same quiet ground), so it is the same size before and after a
 * picture arrives.
 */
export function GridTile({
  name,
  path,
  index,
  rect,
  media,
  selected,
  primary,
  cursor,
  cut,
  landing,
  posInSet,
  setSize,
  handlers
}: {
  name: string
  path: string
  index: number
  rect: Rect
  media: ReactNode
  selected: boolean
  primary: boolean
  cursor: boolean
  cut: boolean
  /** Still being copied in: the percent so far, else undefined. */
  landing: number | undefined
  posInSet: number
  setSize: number
  handlers: HTMLAttributes<HTMLButtonElement> & { draggable?: boolean }
}): JSX.Element {
  const copying = landing !== undefined
  const bar = copying ? landingTile(landing) : null
  return (
    <button
      role="option"
      aria-selected={selected}
      aria-posinset={posInSet}
      aria-setsize={setSize}
      tabIndex={primary ? 0 : -1}
      className="browse-tile"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      data-browse-path={path}
      data-browse-index={index}
      data-selected={selected || undefined}
      data-cursor={(cursor && !primary) || undefined}
      data-cut={cut || undefined}
      data-landing={copying || undefined}
      aria-busy={copying || undefined}
      // Still copying: nothing to open, preview or drag yet.
      inert={copying || undefined}
      {...handlers}
    >
      {media}
      {bar && (
        // The rows' fill bar, across the bottom of the picture box: a percent
        // tick redraws this and nothing else (landingGrid.ts).
        <span
          className="browse-landing browse-tile-landing"
          data-pct={bar.pct}
          style={{ left: TILE_PAD, top: TILE_PAD + rect.w - 2 * TILE_PAD - 4, width: rect.w - 2 * TILE_PAD }}
        >
          <span className="browse-landing-fill" style={{ width: bar.fill }} />
        </span>
      )}
      <span className="browse-tile-name">
        <span {...hiddenTitle(name)}>{bar ? bar.caption : name}</span>
      </span>
    </button>
  )
}
