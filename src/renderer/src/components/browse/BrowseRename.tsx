import { useEffect, useRef, useState, type JSX } from 'react'
import { Dialog } from '../Dialog'

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
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  return (
    <Dialog
      title="Rename"
      onCancel={onCancel}
      body={
        <label>
          New name
          <input
            ref={input}
            aria-label="New name"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && value.trim()) {
                event.preventDefault()
                onSave(value)
              }
            }}
            className="mt-2 block w-full rounded border border-[var(--p-divider)] bg-[var(--p-bg)] p-2 text-[var(--p-text)]"
            spellCheck={false}
            autoComplete="off"
          />
        </label>
      }
      choices={[
        { label: 'Cancel', onPick: onCancel },
        {
          label: 'Rename',
          primary: true,
          onPick: () => {
            if (value.trim()) onSave(value)
          }
        }
      ]}
    />
  )
}
