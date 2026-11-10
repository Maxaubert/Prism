import type { JSX } from 'react'
import { DeleteQuestion } from './DeleteQuestion'
import { deleteLine, deleteTitle, type DeleteSize } from './deleteCopy'

/** One file or folder to the Recycle Bin (the Explorer and the tree). Enter is
 *  Delete (it can be undone); the middle button asks once more, as the
 *  permanent question (#500, owner 2026-11-10). */
export function DeleteDialog({
  name,
  size,
  onCancel,
  onDelete,
  onPermanent
}: {
  name: string
  size?: DeleteSize
  onCancel: () => void
  onDelete: () => void
  onPermanent: () => void
}): JSX.Element {
  return (
    <DeleteQuestion
      icon="trash"
      title={deleteTitle([name], 1, false)}
      line={deleteLine([name], 1, size)}
      onCancel={onCancel}
      choices={[
        { label: 'Cancel', tone: 'plain', onPick: onCancel },
        { label: 'Delete permanently', tone: 'outline', onPick: onPermanent },
        { label: 'Delete', tone: 'danger', focus: true, onPick: onDelete }
      ]}
    />
  )
}
