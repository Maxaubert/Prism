import type { JSX } from 'react'
import { DeleteQuestion } from './DeleteQuestion'
import { deleteLine, deleteTitle, type DeleteSize } from './deleteCopy'

/** Several marked rows to the Recycle Bin at once. The same three buttons as
 *  one item (#500, owner 2026-11-10). */
export function DeleteManyDialog({
  names,
  count,
  size,
  onCancel,
  onDelete,
  onPermanent
}: {
  /** The first names; the line lists two and counts the rest. */
  names: readonly string[]
  count: number
  size?: DeleteSize
  onCancel: () => void
  onDelete: () => void
  onPermanent: () => void
}): JSX.Element {
  return (
    <DeleteQuestion
      icon="trash"
      title={deleteTitle(names, count, false)}
      line={deleteLine(names, count, size)}
      onCancel={onCancel}
      choices={[
        { label: 'Cancel', tone: 'plain', onPick: onCancel },
        { label: 'Delete permanently', tone: 'outline', onPick: onPermanent },
        { label: 'Delete', tone: 'danger', focus: true, onPick: onDelete }
      ]}
    />
  )
}
