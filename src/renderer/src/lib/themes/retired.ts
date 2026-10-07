import type { Style } from '../theme'

/**
 * THE STYLES PRISM SHIPPED UNTIL #298 (2026-10-06), kept word for word. The
 * owner replaced them with the 18 themes of `catalogue.json` ("not happy with
 * the current themes except maybe Void, Frost and Aurora"). They are never
 * offered again; they stay here for two readers only:
 *  - the migration (`migrate.ts`), which reads Onyx's glass to carry it over,
 *    and maps every retired id to its nearest new theme (`RETIRED_MAP`);
 *  - the tests, which hold an own copy saved from one of them (no theme
 *    table) to the derivation it always had, byte for byte
 *    (`legacy.snapshot.json`, taken on the untouched code).
 */
export const RETIRED_STYLES: Style[] = [
  {
    id: 'aurora',
    name: 'Aurora',
    blurb: "Deep space. Prism's default.",
    mode: 'dark',
    // SOLID since 2026-09-20 (owner: "update this theme to be non acrylic by
    // default"). It shipped as acrylic at 35 on the slider, so Prism's own
    // default style let the desktop through the window it was showing a film
    // in. The Acrylic control is untouched and starts at 0 here: glass is a
    // thing to turn on, not a thing to turn off. `glass` is dropped with the
    // material, since it means nothing on a solid style.
    material: 'solid',
    bg: '#0b0d12',
    // One surface for the whole window. Turning the glass off shouldn't hand
    // the panel a tone of its own - separation here is the material, or the
    // Edges control, never a step in shade.
    side: '#0b0d12',
    title: '#0b0d12',
    text: '#f2f4f8',
    folderIcon: '#99bbff', // owner pick, 2026-08-22
    iconMode: 'kind',
    icon: '#8a8e99',
    // A brighter blue than the family indigo (owner pick, 2026-08-21); the
    // folder icons follow it, as they do every accent.
    accent: '#4682fb',
    font: 'system',
    size: '12.5',
    corners: '8',
    // Faint edges everywhere by default: the chrome traces itself even before
    // the material separates it. The accent glow the style launched with was
    // removed 2026-08-21: the glass alone is the look.
    borders: 'faint'
  },
  {
    id: 'default',
    name: 'Onyx',
    blurb: 'Glass over true black.',
    mode: 'dark',
    material: 'acrylic',
    bg: '#000000',
    side: '#141414',
    title: '#141414',
    text: '#eef0f4',
    folderIcon: '#8bb1fd', // owner pick, 2026-08-22
    iconMode: 'kind',
    icon: '#8a8e99',
    accent: 'prism',
    font: 'system',
    size: '12.5',
    corners: '2',
    borders: 'faint'
  },
  {
    id: 'new-void',
    name: 'Void',
    blurb: 'True black, faintly edged.',
    mode: 'dark',
    material: 'oled',
    bg: '#000000',
    side: '#000000',
    title: '#000000',
    text: '#e8eaf0',
    folderIcon: '#8688fd', // owner pick, 2026-08-22
    iconMode: 'dim',
    icon: '#8a8e99',
    accent: 's-indigo',
    font: 'system',
    size: '12.5',
    corners: '2',
    // On true black the edge lines are all the separation there is.
    borders: 'faint'
  },
  {
    id: 'terminal',
    name: 'Terminal',
    blurb: 'Green, square.',
    mode: 'dark',
    material: 'solid',
    bg: '#0b0f14',
    side: '#0d1117',
    title: '#11161d',
    text: '#d7e0d9',
    iconMode: 'custom',
    icon: '#3f9d54',
    accent: 's-green',
    font: 'system',
    size: '12.5',
    corners: '2',
    borders: 'faint'
  },
  {
    id: 'driftwood',
    name: 'Driftwood',
    blurb: 'Warm, tinted, roomy.',
    mode: 'dark',
    material: 'tinted',
    bg: '#16130f',
    side: '#1a1713',
    title: '#221d17',
    text: '#ece2d2',
    iconMode: 'custom',
    icon: '#a1885f',
    accent: 'copper',
    font: 'system',
    size: '12.5',
    corners: '8',
    borders: 'faint'
  },
  {
    id: 'acrylic-red',
    name: 'Ruby',
    blurb: 'Near-black, round corners, red.',
    mode: 'dark',
    // Solid since 2026-08-21 (the id predates the change and stays: it is a
    // saved-settings key, not a description).
    material: 'solid',
    // REPAINTED 2026-09-20, the owner's own picks off the Style page: it was a
    // night blue (#101420) with a crimson accent, and the blue was doing the
    // work a red style should do itself. Near-black lets the red be the only
    // colour in the window. bg, side and title are one value because the
    // material is solid and the one-surface rule derives the panel and the bar
    // from bg anyway (no sideOwn, no titleOwn): the two below are what the
    // schematic cards draw.
    bg: '#0d0d0d',
    side: '#0d0d0d',
    title: '#0d0d0d',
    text: '#eceef5',
    // A hex rather than a scheme id: s-crimson is #e01e4a, which is pink
    // beside this red. Both are the owner's picks.
    folderIcon: '#dc5656',
    iconMode: 'kind',
    icon: '#8a8e99',
    accent: '#e01f1f',
    font: 'system',
    size: '12.5',
    corners: '14',
    borders: 'faint'
  },
  {
    id: 'paper',
    name: 'Paper',
    blurb: 'Solid white, Prism blue.',
    mode: 'light',
    // No acrylic on light styles by default (owner decision, 2026-08-21):
    // glass over a light desktop pulls the window grey. Frost is a slider away.
    material: 'solid',
    bg: '#fbfbfc',
    side: '#eceef1',
    title: '#e1e3e8',
    text: '#1b1d21',
    folderIcon: '#6296fe', // owner pick, 2026-08-22
    iconMode: 'kind',
    icon: '#6b7280',
    accent: 'prism',
    font: 'system',
    size: '12.5',
    corners: '8',
    borders: 'faint'
  },
  {
    id: 'frost',
    name: 'Frost',
    blurb: 'Cool white, deep teal.',
    mode: 'light',
    material: 'solid',
    bg: '#f4f8fb',
    side: '#e9f0f6',
    title: '#e9f0f6',
    text: '#152029',
    folderIcon: '#4d8f89', // owner pick, 2026-08-22
    iconMode: 'custom',
    icon: '#4a7d92',
    accent: 'd-teal',
    font: 'system',
    size: '12.5',
    corners: '14',
    borders: 'faint'
  },
  {
    id: 'linen',
    name: 'Linen',
    blurb: 'Warm paper, bronze.',
    mode: 'light',
    material: 'solid',
    bg: '#f8f4ed',
    side: '#f1ebe1',
    title: '#e9e2d5',
    text: '#241f18',
    iconMode: 'custom',
    icon: '#8a6d45',
    accent: 'd-bronze',
    font: 'system',
    size: '12.5',
    corners: '8',
    borders: 'faint'
  },
  {
    id: 'orchid',
    name: 'Orchid',
    blurb: 'Lilac, tinted by its own accent.',
    mode: 'light',
    material: 'tinted',
    bg: '#f7f1fb',
    side: '#efe4f7',
    title: '#e6d7f2',
    text: '#251a30',
    folderIcon: '#956eb4', // owner pick, 2026-08-22
    iconMode: 'custom',
    icon: '#6b21a8',
    accent: 'd-plum',
    font: 'system',
    size: '12.5',
    corners: '14',
    borders: 'faint'
  }
]

/**
 * Where a saved id that is no longer a theme goes (spec 4). Nobody lands on
 * the default silently: each was mapped by what it looked like.
 */
export const RETIRED_MAP: Record<string, string> = {
  default: 'new-void', // Onyx: black ground and indigo are Void's; its glass is carried over
  terminal: 'obsidian', // near-black, emerald, square
  driftwood: 'carbon', // warm charcoal, amber
  // Ruby went to Ember until Ember retired (#316); Carbon is now the nearest
  // look: near-black, the warm accent nearest red.
  'acrylic-red': 'carbon',
  linen: 'sand', // beige, terracotta
  // ONE OF THE 18 RETIRED (#316; owner, 2026-10-07: "this theme should
  // replace Ember. its Volt but with this teal instead of the yellow"). Its
  // successor took its place on the wall.
  ember: 'jade'
}

/**
 * Themes of the 18 retired since #298, by the name the quiet line says. They
 * are catalogue themes, not the old styles above, so they are not in
 * `RETIRED_STYLES` (held to `legacy.snapshot.json`); only the name is needed.
 */
export const RETIRED_NAMES: Record<string, string> = { ember: 'Ember' }

/** The retired style an id named, for its name and its glass. */
export const retiredById = (id: string): Style | undefined => RETIRED_STYLES.find((s) => s.id === id)

/** The name a retired id went by, for the quiet line. */
export const retiredName = (id: string): string | undefined => retiredById(id)?.name ?? RETIRED_NAMES[id]
