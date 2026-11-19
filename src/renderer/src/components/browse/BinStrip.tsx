import type { JSX } from 'react'
import { FileMenuIcon } from '../icons/FileMenuIcon'
import { binFacts, binStripLabels } from '../../lib/binView'
import { PlaceStrip } from './PlaceStrip'

/**
 * THE STRIP ABOVE THE BIN'S COLUMNS (Recycle Bin feature, D20): the zip
 * strip's slot and look (`PlaceStrip`, place-strip.css), three plain buttons and
 * no fill or accent of its own. Restore and Delete permanently act on the
 * marked rows and are off with none; Empty Recycle Bin is off when the bin is
 * empty. A button whose action is not wired stays inert.
 */
export function BinStrip({
  marked,
  count,
  bytes = 0,
  onRestore,
  onDelete,
  onEmpty
}: {
  /** How many rows are marked. */
  marked: number
  /** How many items the bin holds. */
  count: number
  /** How much the bin holds, from the sizes in its records (#502). */
  bytes?: number
  onRestore?: () => void
  onDelete?: () => void
  onEmpty?: () => void
}): JSX.Element {
  const label = binStripLabels(marked)
  return (
    <PlaceStrip
      icon={<FileMenuIcon name="delete" />}
      name="Recycle Bin"
      facts={binFacts(count, bytes)}
      className="browse-bin-strip"
      data={{ 'data-bin-strip': '', 'data-bin-count': count, 'data-bin-bytes': Math.round(bytes), 'data-testid': 'bin-strip' }}
    >
      <button className="browse-place-button" disabled={!marked} onClick={onRestore} data-bin-verb="restore">
        <FileMenuIcon name="restore" />
        {label.restore}
      </button>
      <button className="browse-place-button" disabled={!marked} onClick={onDelete} data-bin-verb="delete">
        <FileMenuIcon name="delete" />
        {label.remove}
      </button>
      <button className="browse-place-button" disabled={!count} onClick={onEmpty} data-bin-verb="empty">
        <FileMenuIcon name="delete" />
        Empty Recycle Bin
      </button>
    </PlaceStrip>
  )
}
