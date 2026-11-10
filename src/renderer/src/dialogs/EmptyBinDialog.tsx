import type { JSX } from 'react'
import { Dialog } from '../components/Dialog'

/** The whole Recycle Bin emptied (Recycle Bin, D15). Final, so Cancel is the
 *  primary. `count` is given when the bin is open and the list knows it. */
export function EmptyBinDialog({
  count,
  onCancel,
  onEmpty
}: {
  count?: number
  onCancel: () => void
  onEmpty: () => void
}): JSX.Element {
  const counted =
    count === undefined ? '' : ` (${count.toLocaleString('en-US')} ${count === 1 ? 'item' : 'items'})`
  return (
    <Dialog
      title="Empty the Recycle Bin?"
      body={`Everything in it${counted}, on every drive, is deleted for good. Windows cannot put it back.`}
      onCancel={onCancel}
      choices={[
        { label: 'Cancel', onPick: onCancel, primary: true },
        { label: 'Empty', danger: true, onPick: onEmpty }
      ]}
    />
  )
}
