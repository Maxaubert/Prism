import type { JSX } from 'react'
import { Dialog } from '../components/Dialog'
import { DIALOG_EMPHASIS } from '../components/dialogLook'

/** One file or folder to the Recycle Bin (the Explorer and the tree). */
export function DeleteDialog({
  name,
  onCancel,
  onDelete
}: {
  name: string
  onCancel: () => void
  onDelete: () => void
}): JSX.Element {
  return (
    <Dialog
      title="Move to the Recycle Bin?"
      body={
        <>
          <span className={DIALOG_EMPHASIS}>{name}</span> goes to the Recycle Bin, where
          Windows can put it back.
        </>
      }
      onCancel={onCancel}
      choices={[
        { label: 'Cancel', onPick: onCancel },
        { label: 'Delete', danger: true, primary: true, onPick: onDelete }
      ]}
    />
  )
}
