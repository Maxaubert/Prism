import type { JSX } from 'react'
import { Dialog } from '../components/Dialog'
import { ARCHIVE_COPY } from '../components/archive/archiveOps'

/** Members out of a zip, for good: a zip has no Recycle Bin, so the safe
 *  answer (Cancel) is the one Enter picks. */
export function ArchiveDeleteDialog({
  names,
  count,
  onCancel,
  onDelete
}: {
  names: readonly string[]
  /** How many members go (a folder's own members included). */
  count: number
  onCancel: () => void
  onDelete: () => void
}): JSX.Element {
  return (
    <Dialog
      title={ARCHIVE_COPY.deleteTitle(names)}
      body={ARCHIVE_COPY.deleteBody(count)}
      onCancel={onCancel}
      choices={[
        { label: 'Cancel', onPick: onCancel, primary: true },
        { label: 'Delete', danger: true, onPick: onDelete }
      ]}
    />
  )
}
