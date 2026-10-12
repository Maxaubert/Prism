import type { JSX } from 'react'
import type { TextProps } from '@shared/props'
import { langFor } from '../../lib/code/codeLang'
import { formatBytes } from '../../lib/format'
import { langColour } from '../../lib/langColour'
import { count, encodingLabel, eolLabel, headerParent, textCounts, whenLabel } from '../../lib/propsFormat'
import type { BodyProps } from './bodyProps'
import { ChecksumRow } from './ChecksumRow'
import { CodeGlyph, FileGlyph } from '../icons/propertyGlyphs'
import { Facts, Footer, Header, Reading, type Fact } from './parts'
import { useLoaded } from './useLoaded'

type Counts = ReturnType<typeof textCounts>

/** The counts need the whole text; the read is capped and answers a reason
 *  for a file it will not read, which leaves the counts out. */
async function readCounts(path: string): Promise<Counts | null> {
  const read = await window.prism.readText(path)
  return 'text' in read ? textCounts(read.text) : null
}

/**
 * A TEXT FILE, code or prose (owner, 2026-10-12, code round 1 A, "the same
 * rows for text files in general"): the language with its dot first, then
 * the three things that break a file when they are wrong (encoding, BOM,
 * line endings), then the counts, size and date.
 */
export function TextBody({ path, name, onClose }: BodyProps): JSX.Element {
  const lang = langFor(name, path)
  const colour = langColour(lang?.name)
  const shape = useLoaded<TextProps | null>(path, () => window.prism.propsText(path), null)
  const counts = useLoaded(path, () => readCounts(path), null)
  const stat = useLoaded(path, () => window.prism.statFile(path), null)
  const ready = shape !== undefined && counts !== undefined && stat !== undefined

  const rows: Fact[] = [
    {
      label: 'Language',
      value: (
        <>
          <span className="mr-2 inline-block h-[9px] w-[9px] rounded-full" style={{ background: colour }} />
          {lang?.name ?? 'Plain text'}
        </>
      )
    },
    ...(shape
      ? [
          { label: 'Encoding', value: encodingLabel(shape) },
          { label: 'Line endings', value: eolLabel(shape.eol) }
        ]
      : []),
    ...(counts
      ? [
          { label: 'Lines', value: count(counts.lines) },
          { label: 'Words', value: count(counts.words) },
          { label: 'Characters', value: count(counts.chars) }
        ]
      : []),
    ...(stat ? [{ label: 'Size', value: formatBytes(stat.size) }] : []),
    ...(stat ? [{ label: 'Modified', value: whenLabel(stat.mtimeMs) }] : [])
  ]

  return (
    <div data-props-body="text">
      <Header
        icon={lang ? <CodeGlyph /> : <FileGlyph />}
        iconColour={colour}
        title={name}
        sub={headerParent(path)}
      />
      {ready ? (
        <Facts rows={rows}>
          <ChecksumRow path={path} />
        </Facts>
      ) : (
        <Reading />
      )}
      <Footer onClose={onClose} />
    </div>
  )
}
