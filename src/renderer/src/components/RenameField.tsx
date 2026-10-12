import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import { selectStem } from '../lib/selectStem'

/**
 * The row turns into this while you rename it in place: the project tree's
 * rows and an archive's member rows (structure cleanup, 2026-10-12; they were
 * two copies). The stem is preselected. Enter or leaving the field commits,
 * Escape cancels, and only the first of those counts (blur fires after
 * Enter). A name that is empty or unchanged once trimmed is a cancel. Every
 * key stops here: the app's arrow-key paging must not see the typing.
 *
 * The Explorer renames in a dialog (`browse/BrowseRename`), whole name
 * selected; whether it goes inline is the owner's call.
 */
export function RenameField({
  name,
  onSubmit,
  onCancel,
  className,
  style
}: {
  name: string
  onSubmit: (name: string) => void
  onCancel: () => void
  className: string
  style?: CSSProperties
}): JSX.Element {
  const input = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(name)
  const done = useRef(false)

  useEffect(() => {
    const el = input.current
    if (!el) return
    el.focus()
    selectStem(el, name)
  }, [name])

  const finish = (commit: boolean): void => {
    if (done.current) return
    done.current = true
    const next = value.trim()
    if (commit && next && next !== name) onSubmit(next)
    else onCancel()
  }

  return (
    <input
      ref={input}
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(true)
        else if (e.key === 'Escape') finish(false)
      }}
      className={className}
      style={style}
    />
  )
}
