import type { JSX } from 'react'
import { FileMenuIcon } from '../icons/FileMenuIcon'
import { binFacts, binStripLabels } from '../../lib/binView'

/**
 * THE STRIP ABOVE THE BIN'S COLUMNS (Recycle Bin feature, D20): the zip
 * strip's slot and look (`ArchiveStrip`, archive.css), three plain buttons and
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
    <div
      className="browse-archive-strip browse-bin-strip"
      data-bin-strip
      data-bin-count={count}
      data-bin-bytes={Math.round(bytes)}
      data-testid="bin-strip"
    >
      <span className="browse-archive-strip-name">
        <FileMenuIcon name="delete" />
        <strong>Recycle Bin</strong>
        <span className="browse-archive-strip-facts">{binFacts(count, bytes)}</span>
      </span>
      <span className="browse-archive-strip-verbs">
        <button className="browse-archive-button" disabled={!marked} onClick={onRestore} data-bin-verb="restore">
          <FileMenuIcon name="restore" />
          {label.restore}
        </button>
        <button className="browse-archive-button" disabled={!marked} onClick={onDelete} data-bin-verb="delete">
          <FileMenuIcon name="delete" />
          {label.remove}
        </button>
        <button className="browse-archive-button" disabled={!count} onClick={onEmpty} data-bin-verb="empty">
          <FileMenuIcon name="delete" />
          Empty Recycle Bin
        </button>
      </span>
    </div>
  )
}
