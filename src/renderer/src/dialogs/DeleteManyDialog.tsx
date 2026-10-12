import type { JSX } from 'react'
import { Dialog } from '../components/Dialog'

/** Several marked rows to the Recycle Bin at once. */
export function DeleteManyDialog({
  count,
  onCancel,
  onDelete
}: {
  count: number
  onCancel: () => void
  onDelete: () => void
}): JSX.Element {
  return (
    <Dialog
      title={`Move ${count} items to the Recycle Bin?`}
      body="Everything selected goes to the Recycle Bin, where Windows can put it back."
      onCancel={onCancel}
      choices={[
        { label: 'Cancel', onPick: onCancel },
        { label: 'Delete', danger: true, primary: true, onPick: onDelete }
      ]}
    />
  )
}
