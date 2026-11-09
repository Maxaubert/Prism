// A LANDING TILE (zoom grid Stage 6, spec 5.7): a file still being copied in
// is an inert, faded tile with "Copying…" for its name band and the fill bar
// across the bottom of its picture box. This is the part that can be pure:
// what the bar and caption say for a percent. A percentage tick changes the
// fill and the whole percent, never the caption, so a tick re-sorts nothing and
// moves no tile (the rows' rule).

export interface LandingTileView {
  caption: string
  /** The whole percent, for `data-pct`. */
  pct: number
  /** The fill's CSS width. */
  fill: string
}

export function landingTile(pct: number | undefined): LandingTileView {
  const p = typeof pct === 'number' && Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0
  return { caption: 'Copying…', pct: Math.round(p), fill: `${p}%` }
}
