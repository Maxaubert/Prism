import { useMemo, type JSX } from 'react'
import { useFolderSizes } from '../../hooks/useFolderSizes'
import { folderSizeCoverage, folderSizeLabel, folderSizePartial } from '../../lib/folderSize'
import { count, dateFacts } from '../../lib/propsFormat'
import type { BodyProps } from './bodyProps'
import { FolderGlyph } from './glyphs'
import { CopyButton, Facts, Footer, Header, type Fact } from './parts'
import { useLoaded } from './useLoaded'

/**
 * A FOLDER (owner, 2026-10-12, round 1 A "without the newest file"): the
 * full path in the header with a copy button, the size walk as before, and
 * the folder's own dates. Close only: no Open, no Open as project.
 */
export function FolderBody({ path, name, onClose }: BodyProps): JSX.Element {
  const paths = useMemo(() => [path], [path])
  const size = useFolderSizes(paths)[path]
  const stat = useLoaded(path, () => window.prism.statFile(path), null)

  const rows: Fact[] = [
    {
      label: 'Size',
      value: size
        ? `${folderSizeLabel(size)} (${folderSizePartial(size) ? 'at least ' : ''}${count(size.bytes)} bytes)`
        : folderSizeLabel(size)
    },
    ...(size && size.countsKnown !== false
      ? [
          {
            label: 'Contents',
            value: `${count(size.files)} files, ${count(size.folders)} folders (including subfolders)`
          }
        ]
      : []),
    ...(size ? [{ label: 'Coverage', value: folderSizeCoverage(size) }] : []),
    ...dateFacts(stat ?? null)
  ]

  return (
    <div data-props-body="folder">
      <Header
        icon={<FolderGlyph />}
        iconColour="var(--p-kind-folder)"
        title={name}
        sub={path}
        trailing={<CopyButton text={path} label="Copy the path" />}
      />
      <Facts rows={rows} />
      <Footer onClose={onClose} />
    </div>
  )
}

