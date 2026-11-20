import type { BrowseSort } from '@shared/browse'
import { binColumns } from '../../lib/binView'

/** One header button of the list: the sort key it sorts by and its label. */
export type BrowseColumn = { key: BrowseSort['key']; label: string }

const columns: BrowseColumn[] = [
  { key: 'name', label: 'Name' },
  { key: 'type', label: 'Type' },
  { key: 'size', label: 'Size' },
  { key: 'modified', label: 'Date modified' }
]
// Inside an archive (#300): Packed, right after Size, the container's own
// number for what each member occupies.
const archiveColumns: BrowseColumn[] = [
  { key: 'name', label: 'Name' },
  { key: 'type', label: 'Type' },
  { key: 'size', label: 'Size' },
  { key: 'packed', label: 'Packed' },
  { key: 'modified', label: 'Date modified' }
]
const searchColumns: BrowseColumn[] = [
  { key: 'name', label: 'Name' },
  { key: 'path', label: 'Path' },
  { key: 'size', label: 'Size' }
]

/** The header's buttons for the place on screen: a search's, the bin's, an
 *  archive's or a folder's own. */
export function headerColumnsFor(view: {
  searching: boolean
  bin: boolean
  archive: boolean
}): BrowseColumn[] {
  return view.searching
    ? searchColumns
    : view.bin
      ? binColumns
      : view.archive
        ? archiveColumns
        : columns
}
