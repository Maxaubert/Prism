import type { JSX } from 'react'
import { Dialog } from './Dialog'
import { DIALOG_EMPHASIS } from './dialogLook'

/**
 * "Unsaved changes": the one question asked before something strands typed
 * text (closing the window or installing an update, closing a tab, pointing
 * a tab at another folder). One dialog, so the three ask the same way
 * (structure cleanup, 2026-10-12; they were three copies). Only the
 * consequence line differs.
 */
export function UnsavedDialog({
  names,
  consequence,
  onCancel,
  onDiscard,
  onSave
}: {
  /** The unsaved files, as their names are spelled. */
  names: readonly string[]
  /** What going ahead without saving does, one sentence. */
  consequence: string
  onCancel: () => void
  onDiscard: () => void
  onSave: () => void
}): JSX.Element {
  return (
    <Dialog
      title={names.length > 1 ? `${names.length} files have unsaved changes` : 'Unsaved changes'}
      body={
        <>
          <span className={DIALOG_EMPHASIS}>{names.join(', ') || 'This file'}</span>
          {names.length > 1 ? ' are not on disk yet.' : ' has changes that are not on disk yet.'}{' '}
          {consequence}
        </>
      }
      onCancel={onCancel}
      choices={[
        { label: 'Cancel', onPick: onCancel },
        // Not `danger`: discarding here throws away typing, not a file, and
        // the red read as heavier than the act. Same weight as Cancel; "Save
        // all changes" is the one carrying the accent.
        { label: 'Discard', onPick: onDiscard },
        { label: 'Save all changes', primary: true, onPick: onSave }
      ]}
    />
  )
}
