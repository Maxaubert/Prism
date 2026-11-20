import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import { renamedTo } from '../lib/renameName'
import { selectStem } from '../lib/selectStem'

/**
 * The row turns into this while you rename it in place: the project tree's
 * rows, an archive's member rows (structure cleanup, 2026-10-12; they were
 * two copies), the Explorer's rows and tiles, a zip member in the Explorer and the
 * archive's own name (#523, owner 2026-11-19: rename is inline everywhere, the
 * dialog is gone). The stem is preselected. Enter or leaving the field commits,
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
  style,
  label = 'New name'
}: {
  name: string
  onSubmit: (name: string) => void
  onCancel: () => void
  className: string
  style?: CSSProperties
  /** The field's accessible name. */
  label?: string
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
    const next = commit ? renamedTo(name, value) : null
    if (next) onSubmit(next)
    else onCancel()
  }

  return (
    <input
      ref={input}
      value={value}
      aria-label={label}
      spellCheck={false}
      autoComplete="off"
      draggable={false}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
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
