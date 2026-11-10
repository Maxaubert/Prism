import type { JSX } from 'react'
import { Dialog } from '../components/Dialog'
import { DIALOG_EMPHASIS } from '../components/dialogLook'

/** Items of the Recycle Bin deleted for good (Recycle Bin, D14). Windows has
 *  no way back from here, so the safe answer (Cancel) is the one Enter picks,
 *  as `ArchiveDeleteDialog` does. */
export function PermanentDeleteDialog({
  names,
  onCancel,
  onDelete
}: {
  /** The original names of the marked items. */
  names: readonly string[]
  onCancel: () => void
  onDelete: () => void
}): JSX.Element {
  const one = names.length === 1
  return (
    <Dialog
      title={one ? 'Delete permanently?' : `Delete ${names.length} items permanently?`}
      body={
        one ? (
          <>
            &quot;<span className={DIALOG_EMPHASIS}>{names[0]}</span>&quot; is deleted for good. Windows
            cannot put it back.
          </>
        ) : (
          'Everything selected is deleted for good. Windows cannot put it back.'
        )
      }
      onCancel={onCancel}
      choices={[
        { label: 'Cancel', onPick: onCancel, primary: true },
        { label: 'Delete', danger: true, onPick: onDelete }
      ]}
    />
  )
}
