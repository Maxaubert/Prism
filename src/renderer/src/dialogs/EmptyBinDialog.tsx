import type { JSX } from 'react'
import type { BinUsage } from '@shared/ipcTypes'
import { formatBytes } from '../lib/format'
import { DeleteQuestion } from './DeleteQuestion'
import { SIZE_PENDING, emptyBars, itemsText } from './deleteCopy'

/** The whole Recycle Bin emptied (Recycle Bin, D15), with how much it frees
 *  (#503). Final, so Cancel is the default. `usage` is what main counted; the
 *  question opens at once and the count, the size and the bars fill in when it
 *  answers, never holding the buttons. */
export function EmptyBinDialog({
  usage,
  onCancel,
  onEmpty
}: {
  usage?: BinUsage
  onCancel: () => void
  onEmpty: () => void
}): JSX.Element {
  return (
    <DeleteQuestion
      icon="warn"
      title="Empty the Recycle Bin?"
      line={
        <span data-delete-size>
          {usage ? `${itemsText(usage.items)} · ${formatBytes(usage.bytes)}` : SIZE_PENDING}
        </span>
      }
      bars={usage ? emptyBars(usage.drives) : undefined}
      onCancel={onCancel}
      choices={[
        { label: 'Cancel', tone: 'plain', focus: true, onPick: onCancel },
        { label: 'Empty Recycle Bin', tone: 'danger', onPick: onEmpty }
      ]}
    />
  )
}
