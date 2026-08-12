import { useEffect, useState, type JSX } from 'react'
import type { FileKind } from '@shared/types'
import { propsFor, type PropRow } from '../lib/fileProps'
import { Dialog } from './Dialog'

// The Properties popup behind the context menu: the file's facts as quiet
// label/value rows. What counts as a fact depends on the kind - pixels for an
// image, pages for a PDF, words for a document - and lives in lib/fileProps.

export function PropertiesDialog({
  path,
  name,
  kind,
  isFolder,
  onClose
}: {
  path: string
  name: string
  kind: FileKind
  isFolder: boolean
  onClose: () => void
}): JSX.Element {
  const [rows, setRows] = useState<PropRow[] | null>(null)

  useEffect(() => {
    let alive = true
    void propsFor(path, name, kind, isFolder).then((r) => alive && setRows(r))
    return () => {
      alive = false
    }
  }, [path, name, kind, isFolder])

  return (
    <Dialog
      title={name}
      onCancel={onClose}
      body={
        rows === null ? (
          <span className="italic text-[var(--p-dim2)]">Reading…</span>
        ) : (
          <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5">
            {rows.map((r) => (
              <div key={r.label} className="contents">
                <dt className="text-[var(--p-dim2)]">{r.label}</dt>
                <dd className="min-w-0 select-text break-words text-[var(--p-text-soft)]">{r.value}</dd>
              </div>
            ))}
          </dl>
        )
      }
      choices={[{ label: 'Close', primary: true, onPick: onClose }]}
    />
  )
}
