import type { JSX } from 'react'
import { Dialog } from '../components/Dialog'

/** A move or paste that lands on names already taken in the destination. */
export function MoveClashDialog({
  names,
  onCancel,
  onKeepBoth,
  onReplace
}: {
  names: readonly string[]
  onCancel: () => void
  onKeepBoth: () => void
  onReplace: () => void
}): JSX.Element {
  return (
    <Dialog
      title={
        names.length > 1 ? `${names.length} names are already taken` : `"${names[0]}" is already there`
      }
      body="Keep both lands them beside what is there; replacing sends the old ones to the Recycle Bin."
      onCancel={onCancel}
      choices={[
        { label: 'Cancel', onPick: onCancel },
        { label: 'Keep both', primary: true, onPick: onKeepBoth },
        { label: 'Replace', danger: true, onPick: onReplace }
      ]}
    />
  )
}
