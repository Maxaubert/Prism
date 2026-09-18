import { useEffect, useMemo, useState, type JSX } from 'react'
import type { FileKind } from '@shared/types'
import { propsFor, type PropRow } from '../lib/fileProps'
import { Dialog } from './Dialog'
import { useFolderSizes } from '../hooks/useFolderSizes'
import { folderSizeCoverage, folderSizeLabel, folderSizePartial } from '../lib/folderSize'

// The Properties popup behind the context menu: the file's facts as quiet
// label/value rows. What counts as a fact depends on the kind - pixels for an
// image, pages for a PDF, words for a document - and lives in lib/fileProps.

export function PropertiesDialog({
  root,
  path,
  name,
  kind,
  isFolder,
  onClose
}: {
  /** The tab's root: a folder's contents row is a listDir, which is walled. */
  root: string
  path: string
  name: string
  kind: FileKind
  isFolder: boolean
  onClose: () => void
}): JSX.Element {
  const [rows, setRows] = useState<PropRow[] | null>(null)
  const folderPaths = useMemo(() => (isFolder ? [path] : []), [path, isFolder])
  const folderSize = useFolderSizes(folderPaths)[path]
  const displayedRows =
    rows && isFolder
      ? [
          ...rows.filter((row) => row.label !== 'Contents'),
          {
            label: 'Size',
            value: folderSize
              ? `${folderSizeLabel(folderSize)} (${folderSizePartial(folderSize) ? 'at least ' : ''}${folderSize.bytes.toLocaleString()} bytes)`
              : folderSizeLabel(folderSize)
          },
          ...(folderSize
            ? [
                {
                  label: 'Contents',
                  value: `${folderSize.files.toLocaleString()} files, ${folderSize.folders.toLocaleString()} folders (including subfolders)`
                },
                { label: 'Coverage', value: folderSizeCoverage(folderSize) }
              ]
            : [])
        ]
      : rows

  useEffect(() => {
    let alive = true
    void propsFor(root, path, name, kind, isFolder).then((r) => alive && setRows(r))
    return () => {
      alive = false
    }
  }, [root, path, name, kind, isFolder])

  return (
    <Dialog
      title={name}
      onCancel={onClose}
      body={
        displayedRows === null ? (
          <span className="italic text-[var(--p-dim2)]">Reading…</span>
        ) : (
          <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5">
            {displayedRows.map((r) => (
              <div key={r.label} className="contents">
                <dt className="text-[var(--p-dim2)]">{r.label}</dt>
                <dd className="min-w-0 select-text break-words text-[var(--p-text-soft)]">
                  {r.value}
                </dd>
              </div>
            ))}
          </dl>
        )
      }
      choices={[{ label: 'Close', primary: true, onPick: onClose }]}
    />
  )
}
