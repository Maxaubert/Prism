import type { Style, ThemeTable } from '../theme'
import data from './catalogue.json'

/**
 * THE 18 THEMES (#298; owner, 2026-10-06, of a mockup of 42: "perfect, go
 * ahead and build"). `catalogue.json` is the approved data, in WALL ORDER
 * (dark then light, high contrast before see-through in each half), copied
 * from `research/prism/2026-10-06-new-themes/themes.json` minus the mockup's
 * own fields (`suggested`, `why`, `keptFromCurrent`), with Void under its
 * saved id `new-void`. `catalogue.test.ts` holds every value to it.
 *
 * Each becomes a `Style` whose inputs are the editable roles, plus a `table`:
 * the values the theme was designed with that Prism would otherwise derive
 * (menus, the dim inks, the accent's fill and ink, the file kinds, the code
 * colours). The table holds only while its inputs do: `edited()` prunes it
 * against the draft (spec 1.1).
 */
export interface CatalogueTheme {
  id: string
  name: string
  mode: 'dark' | 'light'
  blurb: string
  highContrast: boolean
  seeThrough: boolean
  groundAlpha: number
  material: 'solid' | 'oled' | 'acrylic'
  corners: '2' | '8' | '14'
  edges: 'faint' | 'hairline' | 'strong'
  ground: string
  panel: string
  raised: string
  line: string
  text: string
  textDim: string
  textFaint: string
  accent: string
  accentSolid: string
  onAccent: string
  selection: string
  selectionSeen: string
  folder: string
  kinds: Record<'image' | 'video' | 'audio' | 'pdf' | 'text' | 'archive', string>
  code: Record<
    | 'keyword'
    | 'string'
    | 'number'
    | 'function'
    | 'type'
    | 'tag'
    | 'attribute'
    | 'constant'
    | 'comment'
    | 'punctuation'
    | 'activeLine',
    string
  >
  groundPainted?: string
  panelPainted?: string
  raisedPainted?: string
}

export const CATALOGUE = data as CatalogueTheme[]

/**
 * The surface glass that paints at `alpha`: the inverse of `paintedAlpha`
 * (`1 - (1 - 0.75 g)^3`). The window's glass is read in whole 1/255 steps,
 * so a theme's `groundAlpha` is taken to the step it paints at first: 0.72
 * is 184/255 and 0.82 is 209/255, exactly what `themes.json` paints.
 */
export const glassFor = (alpha: number): number => (1 - Math.cbrt(1 - alpha)) / 0.75

/** The step a designed alpha paints at. */
export const paintedStep = (alpha: number): number => Math.round(alpha * 255) / 255

/**
 * The mockup's tooltips said which themes were kept from the old set; in the
 * app that sentence describes a decision, not the theme, so it is left out.
 */
const blurbOf = (t: CatalogueTheme): string => t.blurb.replace(/\s*Kept from the current set\.\s*$/, '')

/** A shipped theme as the app's model. */
export function themeStyle(t: CatalogueTheme): Style {
  const glassy = t.groundAlpha < 1
  const table: ThemeTable = {
    raised: t.raised,
    line: t.line,
    dim: t.textDim,
    faint: t.textFaint,
    accentFill: t.accent,
    onAccent: t.onAccent,
    kinds: { image: t.kinds.image, video: t.kinds.video, audio: t.kinds.audio, pdf: t.kinds.pdf, text: t.kinds.text },
    code: { ...t.code }
  }
  // High contrast draws EVERY edge in its line (themes.json `edges: strong`,
  // `line` #999999 / #666666); an edit of the Edges control gives it back to
  // the derived scale (`edge` is pruned with `borders`).
  if (t.highContrast) table.edge = t.line
  return {
    id: t.id,
    name: t.name,
    blurb: blurbOf(t),
    mode: t.mode,
    material: t.material,
    ...(glassy ? { glass: glassFor(paintedStep(t.groundAlpha)) } : {}),
    bg: t.ground,
    // THE PANEL IS THE THEME'S OWN (the approved look: a 3 to 3.5% step off
    // the ground), through the `sideOwn` route the one-surface rule already
    // allowed. Six digits, so on glass it follows the ground's alpha.
    side: t.panel,
    sideOwn: true,
    title: t.panel,
    titleOwn: true,
    tabs: t.panel,
    tabsOwn: true,
    text: t.text,
    iconMode: 'kind',
    icon: t.textDim,
    folderIcon: t.folder,
    accent: t.accentSolid,
    selection: t.selection,
    // Every shipped theme sets in the system face (2026-09-20 rule).
    font: 'system',
    size: '12.5',
    corners: t.corners,
    borders: t.edges,
    ...(t.highContrast ? { hc: true } : {}),
    table
  }
}

/** The 18, in wall order. */
export const THEME_STYLES: Style[] = CATALOGUE.map(themeStyle)
