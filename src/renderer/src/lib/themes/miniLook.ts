import { derive, folderIconOf, paintedAlpha, rgba, sideGround, type Style } from '../theme'

/** A theme's colours as its card paints them. Shared with the card's band. */
export function miniLook(st: Style): {
  ground: string
  panel: string
  text: string
  dim: string
  dim2: string
  tint: string
  tintLine: string
  track: string
  folder: string
  edge: string
  accent: string
  frosted: boolean
  kind: (k: string) => string
} {
  const v = derive(st)
  const light = st.mode === 'light'
  // Frost, for real: a see-through theme paints its ground and its panel
  // over the desktop, so the card does too, at the alpha the window uses.
  const glassA = paintedAlpha(st)
  const panel = sideGround(st)
  return {
    frosted: glassA < 1,
    ground: glassA < 1 ? rgba(v['--p-bg'], glassA) : v['--p-bg'],
    panel: glassA < 1 ? rgba(panel, glassA) : panel,
    text: v['--p-text'],
    dim: v['--p-dim'],
    dim2: v['--p-dim2'],
    tint: v['--p-sel-tint'],
    tintLine: v['--p-sel-line'],
    track: v['--p-track'],
    folder: folderIconOf(st),
    kind: (k: string): string => v['--p-kind-' + k],
    // High contrast draws its edges in its own line, as the window does.
    edge: st.hc && st.table?.line ? st.table.line : rgba(st.text, light ? 0.1 : 0.075),
    accent: v['--p-accent-solid']
  }
}
