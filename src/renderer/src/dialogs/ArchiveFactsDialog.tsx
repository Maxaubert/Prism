import type { JSX } from 'react'
import { Dialog } from '../components/Dialog'

/** A zip member's facts (Properties on a row inside an archive). */
export function ArchiveFactsDialog({
  name,
  lines,
  onClose
}: {
  name: string
  lines: ReadonlyArray<readonly [string, string]>
  onClose: () => void
}): JSX.Element {
  return (
    <Dialog
      title={name}
      body={
        <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1">
          {lines.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-[var(--p-dim)]">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      }
      onCancel={onClose}
      choices={[{ label: 'OK', primary: true, onPick: onClose }]}
    />
  )
}
