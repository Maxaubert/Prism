import type { JSX } from 'react'
import { PermanentDeleteDialog } from './PermanentDeleteDialog'
import type { DeleteSize } from './deleteCopy'

/** Members out of a zip: always permanent (a zip has no Recycle Bin), so it is
 *  the permanent question, with no middle button (#500, owner 2026-11-10). */
export function ArchiveDeleteDialog({
  names,
  size,
  onCancel,
  onDelete
}: {
  names: readonly string[]
  size?: DeleteSize
  onCancel: () => void
  onDelete: () => void
}): JSX.Element {
  return PermanentDeleteDialog({ names, size, onCancel, onDelete })
}
