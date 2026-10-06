import { useState, type JSX } from 'react'
import { browsableArchive, segments } from '@shared/archivePlace'
import { KindIcon } from './TreeRows'
import { FileMenuIcon } from './FileMenuIcon'
import './browse/archive.css'

/** The innermost archive a member's path runs through, by its name. */
function zipOf(path: string): string {
  const parts = segments(path)
  for (let i = parts.length - 2; i > 0; i--) if (browsableArchive(parts[i])) return parts[i]
  return ''
}

/**
 * THE READ-ONLY NOTE (#300, mockup 09): over a member opened in full view or
 * in a project, "In <zip>, read-only. Extract it to make changes." and an
 * Extract here that puts the file beside the zip and opens THAT copy, where
 * editing can start. The preview pane carries no note (mockup 04).
 */
export function MemberNote({
  path,
  onExtracted
}: {
  path: string
  /** The extracted copy, opened the way a tree click opens a file. */
  onExtracted?: (path: string) => void
}): JSX.Element {
  const zip = zipOf(path)
  const [busy, setBusy] = useState(false)
  return (
    <div className="member-note" data-member-note>
      <KindIcon kind="archive" ext={/\.[^.]*$/.exec(zip)?.[0]} name={zip} color="var(--p-tree-zip)" size={14} bg="var(--p-bg)" />
      <span>
        In <strong>{zip}</strong>, read-only. Extract it to make changes.
      </span>
      <button
        className="browse-archive-button"
        disabled={busy}
        data-member-extract
        onClick={() => {
          setBusy(true)
          void window.prism
            .archiveMemberOut(path)
            .then((r) => {
              if (r.ok && r.path) onExtracted?.(r.path)
            })
            .finally(() => setBusy(false))
        }}
      >
        <FileMenuIcon name="extract" />
        Extract here
      </button>
    </div>
  )
}
