import type { JSX } from 'react'
import { propsFor } from '../../lib/fileProps'
import { headerParent } from '../../lib/propsFormat'
import type { BodyProps } from './bodyProps'
import { ChecksumRow } from './ChecksumRow'
import { FileGlyph } from '../icons/propertyGlyphs'
import { Facts, Footer, Header, Reading } from './parts'
import { useLoaded } from './useLoaded'

// The kind's colour on the header glyph, as the file list paints it.
const COLOUR: Partial<Record<BodyProps['kind'], string>> = {
  pdf: 'var(--p-kind-pdf)',
  archive: 'var(--p-tree-archive)',
  image: 'var(--p-kind-image)',
  video: 'var(--p-kind-video)',
  audio: 'var(--p-kind-audio)'
}

/**
 * Everything else (spec: "Archives, PDFs, documents and other files keep
 * today's rows in the new frame, plus Checksum"): lib/fileProps gathers
 * them as before. The folder it sits in moves up into the header, so its
 * Location row is not repeated. A film or a song main could not probe lands
 * here too.
 */
export function OtherBody({ root, path, name, kind, onClose }: BodyProps): JSX.Element {
  const rows = useLoaded(path, () => propsFor(root, path, name, kind, false), [])

  return (
    <div data-props-body="other">
      <Header icon={<FileGlyph />} iconColour={COLOUR[kind]} title={name} sub={headerParent(path)} />
      {rows === undefined ? (
        <Reading />
      ) : (
        <Facts rows={rows.filter((r) => r.label !== 'Location')}>
          <ChecksumRow path={path} />
        </Facts>
      )}
      <Footer onClose={onClose} />
    </div>
  )
}
