import { useState, type JSX } from 'react'
import { formatBytes } from '../../lib/format'
import { megapixels } from '../../lib/propsFormat'
import type { BodyProps } from './bodyProps'
import { ChecksumRow } from './ChecksumRow'
import { Banner, Facts, Footer, Group, Sub, Title, type Fact } from './parts'
import { useLoaded } from './useLoaded'

type Info = Awaited<ReturnType<typeof window.prism.photoInfo>>

/** "4032 x 3024" out of whatever exifr's dimensions line says. */
function parseDims(text: string | undefined): { w: number; h: number } | null {
  const m = text ? /(\d+)\D+(\d+)/.exec(text) : null
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null
}

/**
 * A PHOTO (owner, 2026-10-12, round 1 A "without the Show on map button"):
 * the picture across the top, its pixels, megapixels and size on one line,
 * then what the camera wrote in two groups. The pixels come from the
 * banner's own load; a picture Chromium cannot draw (HEIC, RAW) loses the
 * banner and takes them from the file's metadata instead.
 */
export function PhotoBody({ path, name, onClose }: BodyProps): JSX.Element {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const info = useLoaded<Info>(path, () => window.prism.photoInfo(path), {})
  const stat = useLoaded(path, () => window.prism.statFile(path), null)

  const px = dims ?? parseDims(info?.dimensions)
  const sub = [px ? `${px.w} × ${px.h}` : '', px ? megapixels(px.w, px.h) : '', stat ? formatBytes(stat.size) : '']
    .filter(Boolean)
    .join(' · ')

  const camera: Fact[] = []
  const place: Fact[] = []
  if (info?.camera) camera.push({ label: 'Camera', value: info.camera })
  if (info?.lens) camera.push({ label: 'Lens', value: info.lens })
  if (info?.exposure) camera.push({ label: 'Exposure', value: info.exposure })
  if (info?.taken) camera.push({ label: 'Taken', value: info.taken })
  // Coordinates as text: no map, nothing goes online (owner, 2026-10-12).
  if (info?.gps) place.push({ label: 'Location', value: `${info.gps.lat.toFixed(5)}, ${info.gps.lon.toFixed(5)}` })
  if (info?.colour) place.push({ label: 'Colour', value: info.colour })

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
