import type { JSX } from 'react'
import { DeleteQuestion } from './DeleteQuestion'
import { sizeText, deleteTitle, type DeleteSize } from './deleteCopy'

/** Delete for good: the middle button of a delete, the bin's Delete
 *  permanently, and a zip's Delete (a zip has no bin). Windows has no way back
 *  from here, so Cancel is the default (#500, owner 2026-11-10). */
export function PermanentDeleteDialog({
  names,
  count,
  size,
  onCancel,
  onDelete
}: {
  /** The names of what goes (the first few are enough). */
  names: readonly string[]
  /** How many items go, when that is more than the names given. */
  count?: number
  size?: DeleteSize
  onCancel: () => void
  onDelete: () => void
}): JSX.Element {
  return (
    <DeleteQuestion
      icon="warn"
      title={deleteTitle(names, count ?? names.length, true)}
      line={<span data-delete-size>{sizeText(size)}</span>}
      onCancel={onCancel}
      choices={[
        { label: 'Cancel', tone: 'plain', focus: true, onPick: onCancel },
        { label: 'Delete permanently', tone: 'danger', onPick: onDelete }
      ]}
    />
  )
}
