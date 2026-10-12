import type { JSX } from 'react'
import { RenameField } from '../RenameField'

/** Inline rename, Explorer-style: name selected up to the extension. */
export function RenameInput({
  name,
  onSubmit,
  onCancel
}: {
  name: string
  onSubmit: (v: string) => void
  onCancel: () => void
}): JSX.Element {
  return (
    <div className="flex h-[28px] items-center">
      <RenameField
        name={name}
        onSubmit={onSubmit}
        onCancel={onCancel}
        className="w-full max-w-[320px] rounded border border-[var(--p-accent-hi)] bg-[var(--p-bg)] px-1.5 py-0.5 text-[12.5px] text-[var(--p-text)] outline-none"
      />
    </div>
  )
}
