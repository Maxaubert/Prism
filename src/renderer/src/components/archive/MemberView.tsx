import type { JSX } from 'react'
import type { FileKind, ViewerFile } from '@shared/types'
import { loadTransportBg, loadTransportStyle } from '../../lib/transport'
import { ViewerSwitch } from '../ViewerSwitch'
import { ArchiveView } from '../ArchiveView'

/** The extracted member, shown with the same viewers the folder uses. */
export function MemberView({
  name,
  path,
  kind,
  trail
}: {
  name: string
  path: string
  kind: FileKind
  trail?: { label: string; onBack: () => void }[]
}): JSX.Element {
  const file: ViewerFile = {
    path,
    name,
    ext: name.slice(name.lastIndexOf('.')),
    kind,
    size: 0,
    mtimeMs: 0
  }
  return (
    <ViewerSwitch
      file={file}
      mode="member"
      loading={null}
      transportStyle={loadTransportStyle()}
      transportBg={loadTransportBg()}
      // A ZIP INSIDE A ZIP navigates like any other archive rather than
      // dead-ending on "no viewer" (2026-09-01). It is an ordinary thing to
      // meet - a game rip, a backup of a backup - and the member is a real
      // file on disk by the time it gets here, so the panel that reads an
      // archive can simply read this one. Recursion is bounded by the reader:
      // each level is one more preview, and Escape closes them in turn.
      archive={() => <ArchiveView trail={trail} file={file} />}
      unsupported={() => (
        <div className="grid h-full place-items-center text-[13px] text-[var(--p-dim)]">
          No viewer for this file type
        </div>
      )}
    />
  )
}
