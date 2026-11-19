import type { JSX } from 'react'
import { Dialog } from '../components/Dialog'
import { DialogName } from '../components/DialogName'
import { ARCHIVE_COPY } from '../components/archive/archiveOps'

/**
 * The one question for a name that is already taken (#515): a move, a paste, a
 * Restore, a rename, or files added to a zip. The buttons are always Cancel,
 * Keep both (the accent) and Replace (red, only when the place can replace).
 */
export function ClashDialog({
  names,
  where,
  suggestion,
  canReplace,
  onCancel,
  onKeepBoth,
  onReplace
}: {
  names: readonly string[]
  /** A folder, or the inside of a zip (nothing is written there until Keep both). */
  where: 'folder' | 'archive'
  /** What Keep both saves a single name as, when it is known. */
  suggestion?: string
  canReplace: boolean
  onCancel: () => void
  onKeepBoth: () => void
  onReplace?: () => void
}): JSX.Element {
  const many = names.length > 1
  const title =
    where === 'archive'
      ? ARCHIVE_COPY.clashTitle(names)
      : many
        ? `${names.length} names are already taken`
        : `${names[0]} is already there`
  const body =
    where === 'archive' ? (
      ARCHIVE_COPY.clashBody
    ) : suggestion && !many ? (
      <>
        Keep both saves yours as <DialogName>{suggestion}</DialogName>; replacing sends the old one to the
        Recycle Bin.
      </>
    ) : (
      'Keep both lands them beside what is there; replacing sends the old ones to the Recycle Bin.'
    )
  return (
    <Dialog
      title={title}
      body={body}
      onCancel={onCancel}
      choices={[
        { label: 'Cancel', onPick: onCancel },
        { label: 'Keep both', primary: true, onPick: onKeepBoth },
        ...(canReplace && onReplace ? [{ label: 'Replace', danger: true, onPick: onReplace }] : [])
      ]}
    />
  )
}