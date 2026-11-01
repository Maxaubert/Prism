import type { PhotoInfo } from '@shared/ipcTypes'
import { formatBytes } from './format'
import { megapixels } from './propsFormat'

/**
 * WHAT A PHOTO SAYS ABOUT ITSELF, WORDED ONCE (#78, owner 2026-11-01, "approve
 * as recommended"). The Properties window (`properties/PhotoBody.tsx`) and the
 * I key's card (`image/PhotoInfoCard.tsx`) both draw these rows, so the two
 * can never disagree. Pure, so the order and the wording are held by
 * `photoFacts.test.ts`.
 */

export interface PhotoFact {
  label: string
  value: string
  /** Properties draws two groups, Camera and Place; the card one list. */
  group: 'camera' | 'place'
}

export interface PhotoFacts {
  /** "4032 × 3024 · 12.2 MP · 2.4 MB"; empty while none of it is known. */
  line: string
  rows: PhotoFact[]
  /** No camera row at all: the card says `NO_CAMERA` instead. */
  noCamera: boolean
}

export const NO_CAMERA = 'No camera details in this file'

export type Pixels = { w: number; h: number }

/** The picture's own size when it has been drawn, else "4032 x 3024" out of
 *  the metadata (a HEIC or a RAW the window cannot draw). */
export function pixelsOf(drawn: Pixels | null, info: PhotoInfo | undefined): Pixels | null {
  if (drawn) return drawn
  const m = info?.dimensions ? /(\d+)\D+(\d+)/.exec(info.dimensions) : null
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null
}

export function photoFacts(info: PhotoInfo | undefined, px: Pixels | null, size: number | null): PhotoFacts {
  const line = [px ? `${px.w} × ${px.h}` : '', px ? megapixels(px.w, px.h) : '', size !== null ? formatBytes(size) : '']
    .filter(Boolean)
    .join(' · ')
  const rows: PhotoFact[] = []
  const add = (label: string, value: string | undefined, group: PhotoFact['group']): void => {
    if (value) rows.push({ label, value, group })
  }
  add('Camera', info?.camera, 'camera')
  add('Lens', info?.lens, 'camera')
  add('Exposure', info?.exposure, 'camera')
  add('Taken', info?.taken, 'camera')
  add('Colour', info?.colour, 'place')
  // Coordinates as text: no map, nothing goes online (owner, 2026-10-12).
  if (info?.gps) add('Location', `${info.gps.lat.toFixed(5)}, ${info.gps.lon.toFixed(5)}`, 'place')
  return { line, rows, noCamera: !rows.some((r) => r.group === 'camera') }
}
