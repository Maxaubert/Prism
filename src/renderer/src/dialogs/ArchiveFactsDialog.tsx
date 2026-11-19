import type { JSX } from 'react'
import { closeOnly, Dialog } from '../components/Dialog'
import { Facts } from '../components/properties/parts'

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
      // The same list as the file's Properties window (#520).
      body={<Facts className="" rows={lines.map(([label, value]) => ({ label, value }))} />}
      onCancel={onClose}
      choices={closeOnly(onClose)}
    />
  )
}
