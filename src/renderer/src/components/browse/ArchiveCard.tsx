import { useEffect, useState, type JSX } from 'react'
import type { ArchiveSummary } from '@shared/archivePlace'
import { formatBytes, formatWhen } from '../../lib/format'
import { FolderIcon, KindIcon, iconColour } from '../TreeRows'
import { FileMenuIcon } from '../FileMenuIcon'
import { fileKind } from '@shared/fileKind'
import './archive.css'

const extOf = (name: string): string => /\.[^.]*$/.exec(name.toLowerCase())?.[0] ?? ''

/**
 * THE ARCHIVE CARD (#300, mockup 01): what the preview pane shows for an
 * archive's row outside it, in place of the old panel. Its name and totals,
 * the neutral Open / Extract here / Extract to..., and the top of what is
 * inside ("Inside, in <the one top folder>" when that is all there is), with
 * Unpacked and Modified at the foot. Drawn from one `archive:summary`, which
 * main answers from the parse it keeps, so selecting a zip is instant.
 */
export function ArchiveCard({
  path,
  name,
  mtimeMs,
  onOpen,
  onExtractHere,
  onExtractTo
}: {
  path: string
  name: string
  mtimeMs?: number
  onOpen: () => void
  onExtractHere: () => void
  onExtractTo: () => void
}): JSX.Element {
  const [summary, setSummary] = useState<{ path: string; got: ArchiveSummary } | null>(null)
  useEffect(() => {
    let live = true
    void window.prism
      .archiveSummary(path)
      .then((got) => live && setSummary({ path, got }))
      .catch(() => live && setSummary({ path, got: { ok: false, reason: 'failed' } }))
    return () => {
      live = false
    }
  }, [path])
  const got = summary?.path === path ? summary.got : null
  const meta = got?.ok ? got.meta : null
  const facts = meta
    ? [
        `${meta.files} ${meta.files === 1 ? 'file' : 'files'}`,
        meta.folders ? `${meta.folders} ${meta.folders === 1 ? 'folder' : 'folders'}` : '',
        `${formatBytes(meta.packed)} compressed`
      ]
        .filter(Boolean)
        .join(', ')
    : got && !got.ok
      ? got.reason === 'password' || got.reason === 'aes'
        ? 'Password protected'
        : "This archive can't be read. It may be damaged or incomplete."
      : ''
  return (
    <div className="archive-card" data-archive-card>
      <div className="archive-card-head">
        <KindIcon kind="archive" ext={extOf(name)} name={name} color="var(--p-tree-zip)" size={48} bg="var(--p-bg)" />
        <div className="min-w-0">
          <h2>{name}</h2>
          <p>{facts}</p>
        </div>
      </div>
      <div className="archive-card-verbs">
        <button className="browse-archive-button" onClick={onOpen} data-archive-verb="open">
          <FileMenuIcon name="open" />
          Open
        </button>
        <button className="browse-archive-button" onClick={onExtractHere} data-archive-verb="extract-here">
          <FileMenuIcon name="extract" />
          Extract here
        </button>
        <button className="browse-archive-button" onClick={onExtractTo} data-archive-verb="extract-to">
          <FileMenuIcon name="extract" />
          Extract to...
        </button>
      </div>
      {got?.ok && (
        <>
          <div className="archive-card-caption">{got.top ? `Inside, in ${got.top}` : 'Inside'}</div>
          <div className="archive-card-rows">
            {got.rows.map((row) => (
              <div className="archive-card-row" key={row.name}>
                {row.dir ? (
                  <FolderIcon color="var(--p-tree-folder)" />
                ) : (
                  <KindIcon
                    kind={fileKind(extOf(row.name), row.name)}
                    ext={extOf(row.name)}
                    name={row.name}
                    color={iconColour(fileKind(extOf(row.name), row.name))}
                    size={14}
                    bg="var(--p-bg)"
                  />
                )}
                <span>{row.name}</span>
                <span>{row.dir ? '' : formatBytes(row.size)}</span>
              </div>
            ))}
          </div>
          <dl className="archive-card-facts">
            <dt>Unpacked</dt>
            <dd>{formatBytes(got.meta.unpacked)}</dd>
            {!!mtimeMs && (
              <>
                <dt>Modified</dt>
                <dd>{formatWhen(mtimeMs)}</dd>
              </>
            )}
          </dl>
        </>
      )}
    </div>
  )
}
