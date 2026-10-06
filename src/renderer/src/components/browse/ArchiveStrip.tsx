import type { JSX } from 'react'
import type { ArchiveMeta } from '@shared/types'
import { formatBytes } from '../../lib/format'
import { KindIcon } from '../TreeRows'
import { FileMenuIcon } from '../FileMenuIcon'

/**
 * THE STRIP INSIDE AN ARCHIVE (#300, mockup 03): one 40 px line above the
 * column header that names the zip you are in, what it holds and what it
 * weighs packed, with Extract here and Extract to... at its end.
 *
 * No fill of its own (the spec's Decision 4): the mockup tinted it toward the
 * zip colour, and under a see-through style a second translucent coat over the
 * list's ground reads as a darker band, so it sits on the list's ground with
 * the divider under it. The buttons are neutral row buttons, never the accent
 * (#202), and focus is the hover's fill (#272). Read-only formats keep both,
 * since extracting writes to the disk, not to the archive.
 */
export function ArchiveStrip({
  meta,
  done,
  onExtractHere,
  onExtractTo
}: {
  meta: ArchiveMeta
  /** "Extracted" for two seconds after Extract here worked, the old verb
   *  row's rule. */
  done: boolean
  onExtractHere: () => void
  onExtractTo: () => void
}): JSX.Element {
  const files = `${meta.files} ${meta.files === 1 ? 'file' : 'files'}`
  return (
    <div className="browse-archive-strip" data-archive-strip data-testid="archive-strip">
      <span className="browse-archive-strip-name">
        <KindIcon kind="archive" ext={meta.display.replace(/^.*\./, '')} name={meta.display} color="var(--p-tree-zip)" size={16} bg="var(--p-bg)" />
        <strong title={meta.base}>{meta.display}</strong>
        <span className="browse-archive-strip-facts">
          {files}, {formatBytes(meta.packed)} compressed{meta.readOnly ? ', read-only' : ''}
        </span>
      </span>
      <span className="browse-archive-strip-verbs">
        <button className="browse-archive-button" onClick={onExtractHere} data-archive-verb="extract-here">
          <FileMenuIcon name="extract" />
          {done ? 'Extracted' : 'Extract here'}
        </button>
        <button className="browse-archive-button" onClick={onExtractTo} data-archive-verb="extract-to">
          <FileMenuIcon name="extract" />
          Extract to...
        </button>
      </span>
    </div>
  )
}
