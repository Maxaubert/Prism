import type { JSX } from 'react'
import { Dialog } from '../components/Dialog'
import { DialogName } from '../components/DialogName'

/** A file with unsaved edits was rewritten on disk. Dismissing it keeps the
 *  user's version, the same as "Keep mine". */
export function FileChangedDialog({
  name,
  onKeep,
  onReload
}: {
  name: string
  onKeep: () => void
  onReload: () => void
}): JSX.Element {
  return (
    <Dialog
      title="This file changed on disk"
      body={
        <>
          Something outside Prism rewrote <DialogName>{name}</DialogName>{' '}
          while you have unsaved changes in it. There is no merge: it is your version or the one
          on disk.
        </>
      }
      onCancel={onKeep}
      choices={[
        { label: 'Keep mine', onPick: onKeep },
        { label: 'Reload from disk', danger: true, onPick: onReload }
      ]}
    />
  )
}
