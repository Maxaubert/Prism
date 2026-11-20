import { useState, type JSX } from 'react'
import { Dialog } from '../components/Dialog'
import { DialogInput } from '../components/DialogInput'
import { DialogName } from '../components/DialogName'

// Its own file since #300: the archive panel (the phone's) and the Explorer's
// places inside archives ask the same question.

/** The password question, asked once per archive and remembered after. */
export function PasswordDialog({
  name,
  wrong,
  onSubmit,
  onCancel
}: {
  name: string
  wrong: boolean
  onSubmit: (pw: string) => void
  onCancel: () => void
}): JSX.Element {
  const [value, setValue] = useState('')

  return (
    <Dialog
      title="This archive is password protected"
      body={
        <div>
          <div>
            {wrong ? "That password didn't open " : 'Enter the password to open '}
            <DialogName>{name}</DialogName>
            {wrong ? '. Try again:' : ':'}
          </div>
          <DialogInput
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onEnter={() => onSubmit(value)}
            canEnter={!!value}
            className="mt-2.5"
            aria-label="Archive password"
          />
        </div>
      }
      onCancel={onCancel}
      choices={[
        { label: 'Cancel', onPick: onCancel },
        { label: 'Unlock', primary: true, onPick: () => value && onSubmit(value) }
      ]}
    />
  )
}

