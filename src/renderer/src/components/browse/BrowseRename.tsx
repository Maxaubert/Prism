import { useEffect, useRef, useState, type JSX } from 'react'
import { selectStem } from '../../lib/selectStem'
import { Dialog } from '../Dialog'
import { RENAME_WORDS, type RenameWords } from '../../dialogs/renameWording'

/**
 * Rename in a dialog: the Explorer's rows, a member of a zip in the Explorer,
 * and an archive's own Rename verb. The Explorer selects the whole name
 * (whether it renames inline like the tree is the owner's call); the
 * archive's verb selects the stem. Inline renames are `RenameField`.
 */

export function BrowseRename({
  name,
  onSave,
  onCancel,
  words = RENAME_WORDS,
  title = words.title,
  select = 'all'
}: {
  name: string
  onSave: (name: string) => void
  onCancel: () => void
  /** The dialog's words: Rename (the default) or a new folder's. */
  words?: RenameWords
  /** A title of its own over `words` (the archive's own Rename). */
  title?: string
  /** What is selected when it opens: the whole name, or up to the extension. */
  select?: 'all' | 'stem'
}): JSX.Element {
  const [value, setValue] = useState(name)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = input.current
    if (!el) return
    el.focus()
    if (select === 'stem') selectStem(el, name)
    else el.select()
    // Once, on open: the name is the one the dialog was opened for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <Dialog
      title={title}
      onCancel={onCancel}
      body={
        <label>
          {words.label}
          <input
            ref={input}
            aria-label={words.label}
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
          label: words.done,
          primary: true,
          onPick: () => {
            if (value.trim()) onSave(value)
          }
        }
      ]}
    />
  )
}
