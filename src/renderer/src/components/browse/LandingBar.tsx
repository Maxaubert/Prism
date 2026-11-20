import type { CSSProperties, JSX } from 'react'
import { landingTile } from '../../lib/landingGrid'
import { ProgressBar } from '../ProgressBar'

/**
 * THE FILL OF A FILE STILL BEING COPIED IN (#524), in a row's size cell and
 * across a tile's picture. One component, so the row and the tile read the
 * percent the same way (`landingTile`: clamped, whole) and name the bar the
 * same. The bar itself is the one ProgressBar (#501).
 */
export function LandingBar({
  pct,
  className = '',
  style
}: {
  pct: number | undefined
  className?: string
  style?: CSSProperties
}): JSX.Element {
  return (
    <ProgressBar
      size="thin"
      className={`browse-landing ${className}`.trim()}
      pct={landingTile(pct).pct}
      label="Copying"
      style={style}
    />
  )
}