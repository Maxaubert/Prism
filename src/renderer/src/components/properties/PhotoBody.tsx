import { useState, type JSX } from 'react'
import { photoFacts, pixelsOf } from '../../lib/photoFacts'
import type { BodyProps } from './bodyProps'
import { ChecksumRow } from './ChecksumRow'
import { Banner, Facts, Footer, Group, Sub, Title } from './parts'
import { useLoaded } from './useLoaded'

type Info = Awaited<ReturnType<typeof window.prism.photoInfo>>

/**
 * A PHOTO (owner, 2026-10-12, round 1 A "without the Show on map button"):
 * the picture across the top, its pixels, megapixels and size on one line,
 * then what the camera wrote in two groups. The pixels come from the
 * banner's own load; a picture Chromium cannot draw (HEIC, RAW) loses the
 * banner and takes them from the file's metadata instead. The rows are
 * `lib/photoFacts.ts`, shared with the I key's card (#78).
 */
export function PhotoBody({ path, name, onClose }: BodyProps): JSX.Element {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const info = useLoaded<Info>(path, () => window.prism.photoInfo(path), {})
  const stat = useLoaded(path, () => window.prism.statFile(path), null)

  // The rows are worded once, for here and the I key's card (#78).
  const facts = photoFacts(info, pixelsOf(dims, info), stat ? stat.size : null)
  const sub = facts.line
  const camera = facts.rows.filter((r) => r.group === 'camera')
  const place = facts.rows.filter((r) => r.group === 'place')

  return (
    <div data-props-body="photo">
      <Banner src={window.prism.mediaUrl(path)} height={178} onSize={(w, h) => setDims({ w, h })} />
      <Title text={name} />
      {sub && <Sub text={sub} />}
      <Group title="Camera" rows={camera} />
      <Group title="Place" rows={place} />
      <Facts rows={[]} className="mt-4">
        <ChecksumRow path={path} />
      </Facts>
      <Footer onClose={onClose} />
    </div>
  )
}
