import type { HTMLAttributes, JSX, ReactNode } from 'react'
import { hiddenTitle } from 'prism-term-core/renderer/lib/hiddenTitle'
import type { Rect } from '../../lib/gridLayout'

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
  landing: boolean
  posInSet: number
  setSize: number
  handlers: HTMLAttributes<HTMLButtonElement> & { draggable?: boolean }
}): JSX.Element {
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
      data-landing={landing || undefined}
      aria-busy={landing || undefined}
      // Still copying: nothing to open, preview or drag yet.
      inert={landing || undefined}
      {...handlers}
    >
      {media}
      <span className="browse-tile-name">
        <span {...hiddenTitle(name)}>{name}</span>
      </span>
    </button>
  )
}
