import type { JSX } from 'react'
import { Dialog } from '../components/Dialog'
import { ARCHIVE_COPY } from '../components/archive/archiveOps'

/** Files added to a zip land on names it already has. Nothing is written
 *  until Keep both. */
export function ArchiveClashDialog({
  names,
  onCancel,
  onKeepBoth
}: {
  names: readonly string[]
  onCancel: () => void
  onKeepBoth: () => void
}): JSX.Element {
  return (
    <Dialog
      title={ARCHIVE_COPY.clashTitle(names)}
      body={ARCHIVE_COPY.clashBody}
      onCancel={onCancel}
      choices={[
        { label: 'Cancel', onPick: onCancel },
        { label: 'Keep both', primary: true, onPick: onKeepBoth }
      ]}
    />
  )
}
