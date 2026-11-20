import type { HTMLAttributes, JSX, ReactNode } from 'react'
import { hiddenTitle } from 'prism-term-core/renderer/lib/hiddenTitle'
import { formatBytes, formatWhen } from '../../lib/format'
import { folderSizeCoverage, folderSizeLabel } from '../../lib/folderSize'
import { typeLabel } from '../../lib/typeLabel'
import { browseParent } from '../../lib/browse'
import { binnedOf, binnedPath } from '../../lib/binView'
import { landingTile } from '../../lib/landingGrid'
import { LandingBar } from './LandingBar'
import type { BrowseEntry } from './types'

/** A row that is not an entry: a blank still on its way (#271), or an item a
 *  search could not give back. */
export function PendingRow({ unavailable }: { unavailable: boolean }): JSX.Element {
  return (
    <div className="browse-row" aria-hidden="true">
      <span className="browse-column-name browse-name">
        {/* A search row still on its way is a blank row (#271):
            no loading text anywhere in the list. */}
        {unavailable ? 'Item unavailable' : ''}
      </span>
    </div>
  )
}

/** A date group's label row (Downloads, #285): not a row, nothing to pick,
 *  focus, drag or drop on, and hidden from the listbox, whose options are
 *  files. */
export function DividerRow({ group, label }: { group: string; label: string }): JSX.Element {
  return (
    <div className="browse-divider" aria-hidden="true" data-date-group={group}>
      <span>{label}</span>
    </div>
  )
}

/**
 * ONE ROW OF THE LIST: the entry's picture and name, then the columns the
 * place has (the bin's, a search's, an archive's, a folder's). It owns no
 * behaviour: BrowseList builds the handlers, the picture and the rename field
 * and hands them in.
 */
export function BrowseRow({
  entry,
  itemIndex,
  posInSet,
  setSize,
  primary,
  selected,
  joinUp,
  joinDown,
  cursor,
  cut,
  landing,
  description,
  searching,
  bin,
  archive,
  picture,
  renameField,
  handlers
}: {
  entry: BrowseEntry
  /** The row's index among the rows as drawn (dividers counted). */
  itemIndex: number
  posInSet: number
  setSize: number
  primary: boolean
  selected: boolean
  joinUp: boolean
  joinDown: boolean
  /** The keyboard's cursor is on this row while it is not the primary one. */
  cursor: boolean
  cut: boolean
  /** How far a paste has got copying this item (0-100), or undefined. */
  landing: number | undefined
  description: string | undefined
  searching: boolean
  bin: boolean
  archive: boolean
  picture: ReactNode
  /** Set while this entry is being renamed (#523). */
  renameField: ReactNode | null
  /** Absent while the row is being renamed: the field's mouse is the field's. */
  handlers: (HTMLAttributes<HTMLElement> & { draggable?: boolean }) | undefined
}): JSX.Element {
  // Being renamed (#523): the row is a plain box with the field in it,
  // no press, drag or drop of its own (the field's mouse is the field's).
  const renamingHere = renameField != null
  const Row = renamingHere ? 'div' : 'button'
  const landingOn = landing !== undefined
  return (
    <Row
      role="option"
      aria-selected={selected}
      aria-posinset={posInSet}
      aria-setsize={setSize}
      tabIndex={primary ? 0 : -1}
      className="browse-row"
      data-cut={cut || undefined}
      data-landing={landingOn || undefined}
      aria-busy={landingOn || undefined}
      // Still copying: nothing to open, preview or drag yet.
      inert={landingOn || undefined}
      aria-description={description}
      data-browse-path={entry.path}
      data-browse-index={itemIndex}
      data-selected={selected || undefined}
      data-cursor={(cursor && !primary) || undefined}
      data-join-up={joinUp || undefined}
      data-join-down={joinDown || undefined}
      title={searching ? entry.path : undefined}
      {...(renamingHere ? {} : handlers)}
    >
      <span className="browse-column-name browse-name">
        {picture}
        {renamingHere ? (
          renameField
        ) : (
          <span className="browse-name-text">
            <span {...(searching ? {} : hiddenTitle(entry.name))}>{entry.name}</span>
          </span>
        )}
      </span>
      {/* THE BIN'S TWO COLUMNS (D7): where it was and when it was
          deleted, right after the name. The full original path
          is the cell's title. */}
      {bin && !searching && (
        <>
          <span
            className="browse-column-from"
            title={binnedOf(entry) ? binnedPath(binnedOf(entry)!.from, entry.name) : undefined}
          >
            {binnedOf(entry)?.from ?? ''}
          </span>
          <span className="browse-column-deleted">
            {binnedOf(entry) ? formatWhen(binnedOf(entry)!.at) : ''}
          </span>
        </>
      )}
      {!(bin && !searching) && (
        <span
          className={
            searching ? 'browse-column-path browse-result-location' : 'browse-column-type'
          }
        >
          {searching
            ? (browseParent(entry.path) ?? entry.path)
            : landingOn
              ? landingTile(landing).caption
              : typeLabel(entry.name, entry.isFolder)}
        </span>
      )}
      <span
        className="browse-column-size"
        title={entry.folderSize ? folderSizeCoverage(entry.folderSize) : undefined}
      >
        {/* No size yet is a blank cell, never "0 B" (#271). */}
        {landingOn ? (
          <LandingBar pct={landing} />
        ) : entry.file ? (
          entry.file.size === undefined ? (
            ''
          ) : (
            formatBytes(entry.file.size)
          )
        ) : (
          folderSizeLabel(entry.folderSize)
        )}
      </span>
      {archive && !searching && (
        <span className="browse-column-packed">
          {entry.file?.packed !== undefined ? formatBytes(entry.file.packed) : ''}
        </span>
      )}
      {bin && !searching && (
        <span className="browse-column-type">{typeLabel(entry.name, entry.isFolder)}</span>
      )}
      {!searching && !bin && (
        <span className="browse-column-modified">
          {/* A folder's date too, now it has one (#285). */}
          {formatWhen(entry.file ? entry.file.mtimeMs : entry.mtimeMs)}
        </span>
      )}
    </Row>
  )
}
