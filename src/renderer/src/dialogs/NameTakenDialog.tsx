import type { JSX } from 'react'
import { Dialog } from '../components/Dialog'
import { DIALOG_EMPHASIS } from '../components/dialogLook'

/** A rename onto a name the folder already has. */
export function NameTakenDialog({
  name,
  suggestion,
  onCancel,
  onReplace,
  onKeepBoth
}: {
  name: string
  /** What Keep both saves it as. */
  suggestion: string
  onCancel: () => void
  onReplace: () => void
  onKeepBoth: () => void
}): JSX.Element {
  return (
    <Dialog
      title="That name is taken"
      body={
        <>
          This folder already has a <span className={DIALOG_EMPHASIS}>{name}</span>. Keeping
          both saves yours as <span className={DIALOG_EMPHASIS}>{suggestion}</span>;
          replacing it sends the old one to the Recycle Bin.
        </>
      }
      onCancel={onCancel}
      choices={[
        { label: 'Cancel', onPick: onCancel },
        { label: 'Replace', danger: true, onPick: onReplace },
        { label: 'Keep both', primary: true, onPick: onKeepBoth }
      ]}
    />
  )
}
