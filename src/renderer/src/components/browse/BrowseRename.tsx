import { useState, type JSX } from 'react'
import { Dialog } from '../Dialog'
import { DialogInput } from '../DialogInput'
import { renamedTo } from '../../lib/renameName'

/**
 * Rename in a dialog, for ONE case only (#523, owner 2026-11-19: rename is
 * inline everywhere): F2 on a file that is open full view, where no row or tile
 * is on screen to hold the field. Every row, tile and zip member renames in
 * place (`RenameField`). It answers like them: the stem selected, the name
 * trimmed, an unchanged or empty name is Cancel (`renamedTo`).
 */
export function BrowseRename({
  name,
  onSave,
  onCancel
}: {
  name: string
  onSave: (name: string) => void
  onCancel: () => void
}): JSX.Element {
  const [value, setValue] = useState(name)
  const answer = (): void => {
    const next = renamedTo(name, value)
    if (next) onSave(next)
    else onCancel()
  }

  return (
    <Dialog
      title="Rename"
      onCancel={onCancel}
      body={
        <label>
          New name
          <DialogInput
            aria-label="New name"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            select="stem"
            stemOf={name}
            onEnter={answer}
            canEnter={!!value.trim()}
            className="mt-2 block"
            spellCheck={false}
            autoComplete="off"
          />
        </label>
      }
      choices={[
        { label: 'Cancel', onPick: onCancel },
        { label: 'Rename', primary: true, onPick: answer }
      ]}
    />
  )
}