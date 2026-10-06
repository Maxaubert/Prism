import type { JSX } from 'react'
import type { BrowseDriveUsage } from '@shared/browse'
import {
  driveGlyph,
  driveName,
  driveSizes,
  freeLine,
  gaugeSteps,
  ringDash,
  usedFraction,
  usedPercent,
  usedWidth
} from '../../lib/driveUsage'
import type { DriveStyle } from '../../lib/driveStylePrefs'
import { PlaceIcon } from './PlaceIcon'

/** The Gauge's steps and the Ring's radius in its 24 unit box. */
const GAUGE_STEPS = 20
const RING_R = 10

/**
 * WHAT A THIS PC ROW SHOWS, in the style picked on Settings > Explorer (#296;
 * owner, 2026-10-06, of the drive row mockups: "option A, D and E as options
 * in settings, with A being default"). Only the inside of the row: the button
 * round it, with its click, menu, drop and current place, is the panel's and
 * the same for all three. The row's class carries the style and `data-warn`
 * (from 90% used), and the CSS draws the rest (`drive-rows.css`).
 *
 *  - Tiles (A): the glyph in a chip, the name with the percent at its end, a
 *    pill bar, and "X free of Y" under it.
 *  - Ring (D): the glyph, the name over "X free of Y", a small donut with the
 *    percent inside.
 *  - Gauge (E): the glyph in a chip and the name, a 20 step meter, free at its
 *    left end and the total at its right.
 *
 * A drive that has not answered with sizes shows its glyph and name alone.
 */
export function DriveBody({
  path,
  info,
  look
}: {
  path: string
  info: BrowseDriveUsage | undefined
  look: DriveStyle
}): JSX.Element {
  const name = driveName(path, info)
  const used = usedFraction(info?.total, info?.free)
  const pct = usedPercent(info?.total, info?.free)
  // The badge sits at the GLYPH's corner, so in a chip the glyph has a box
  // of its own inside it, as the mockup draws it.
  const glyph = (
    <span className="browse-drive-ic" data-drive-glyph={driveGlyph(info?.kind)} data-system={info?.system ? '' : undefined}>
      <PlaceIcon name={driveGlyph(info?.kind)} />
      {info?.system && (
        <span className="browse-drive-win" data-windows-badge="" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
      )}
    </span>
  )
  const icon = (chip: boolean): JSX.Element =>
    chip ? <span className="browse-drive-chip">{glyph}</span> : glyph
  const nameEl = <span className="browse-drive-name">{name}</span>

  if (look === 'ring') {
    return (
      <>
        {icon(false)}
        <span className="browse-drive-txt">
          {nameEl}
          {used !== null && <span className="browse-drive-free">{freeLine(info?.total, info?.free)}</span>}
        </span>
        {used !== null && (
          <span className="browse-drive-donut" data-used={used.toFixed(4)}>
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="browse-drive-ring-track" cx="12" cy="12" r={RING_R} fill="none" strokeWidth="2.2" />
              <circle
                className="browse-drive-ring-used"
                cx="12"
                cy="12"
                r={RING_R}
                fill="none"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeDasharray={ringDash(used, RING_R)}
              />
            </svg>
            <b className="browse-drive-pct" aria-hidden="true">
              {pct}
            </b>
            {/* The donut's bare number means nothing read aloud. */}
            <span className="sr-only">{pct}% used</span>
          </span>
        )}
      </>
    )
  }

  if (look === 'gauge') {
    const lit = gaugeSteps(info?.total, info?.free, GAUGE_STEPS)
    const sizes = driveSizes(info?.total, info?.free)
    return (
      <>
        <span className="browse-drive-head">
          {icon(true)}
          {nameEl}
        </span>
        {sizes && (
          <>
            {/* The meter is drawn only, so its share is said in words. */}
            <span className="sr-only">{pct}% used</span>
            <span className="browse-drive-seg" data-lit={lit} aria-hidden="true">
              {Array.from({ length: GAUGE_STEPS }, (_, i) => (
                <i key={i} data-on={i < lit ? '' : undefined} />
              ))}
            </span>
            <span className="browse-drive-nums">
              <span className="browse-drive-free">
                <em>{sizes.free}</em> free
              </span>
              <span className="sr-only">of</span>
              <span className="browse-drive-total">{sizes.total}</span>
            </span>
          </>
        )}
      </>
    )
  }

  // Tiles, the default.
  const width = usedWidth(info?.total, info?.free)
  return (
    <>
      {icon(true)}
      <span className="browse-drive-l1">
        {nameEl}
        {pct !== null && <span className="browse-drive-pct">{pct}%</span>}
        {pct !== null && <span className="sr-only">used</span>}
      </span>
      {width !== null && (
        <>
          <span className="browse-drive-bar" aria-hidden="true">
            <i style={{ width }} />
          </span>
          <span className="browse-drive-free">{freeLine(info?.total, info?.free)}</span>
        </>
      )}
    </>
  )
}
