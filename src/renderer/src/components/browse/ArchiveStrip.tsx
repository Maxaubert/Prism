import type { JSX } from 'react'
import type { ArchiveMeta } from '@shared/types'
import { plural } from '../../lib/emptyText'
import { formatBytes } from '../../lib/format'
import { KindIcon } from '../icons/FileIcons'
import { FileMenuIcon } from '../icons/FileMenuIcon'
import { PlaceStrip } from './PlaceStrip'

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
  const files = plural(meta.files, 'file')
  return (
    <PlaceStrip
      icon={<KindIcon kind="archive" ext={meta.display.replace(/^.*\./, '')} name={meta.display} color="var(--p-tree-zip)" size={16} bg="var(--p-bg)" />}
      name={meta.display}
      nameTitle={meta.base}
      facts={`${files}, ${formatBytes(meta.packed)} compressed${meta.readOnly ? ', read-only' : ''}`}
      data={{ 'data-archive-strip': '', 'data-testid': 'archive-strip' }}
    >
      <button className="browse-place-button" onClick={onExtractHere} data-archive-verb="extract-here">
        <FileMenuIcon name="extract" />
        {done ? 'Extracted' : 'Extract here'}
      </button>
      <button className="browse-place-button" onClick={onExtractTo} data-archive-verb="extract-to">
        <FileMenuIcon name="extract" />
        Extract to...
      </button>
    </PlaceStrip>
  )
}
