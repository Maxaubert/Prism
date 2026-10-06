import { useEffect, useRef, useState, type JSX } from 'react'
import { Dialog } from './Dialog'

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
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  return (
    <Dialog
      title="This archive is password protected"
      body={
        <div>
          <div>
            {wrong
              ? `That password didn't open "${name}". Try again:`
              : `Enter the password to open "${name}":`}
          </div>
          <input
            ref={input}
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' && value) onSubmit(value)
            }}
            className="mt-2.5 w-full rounded border border-[color:var(--p-divider)] bg-[var(--p-bg)] px-2 py-1.5 text-[12.5px] text-[var(--p-text)] outline-none focus:border-[color:var(--p-accent-hi)]"
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

