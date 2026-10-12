/**
 * THE APP'S LINE GLYPHS, ONE STRING EACH (structure cleanup, 2026-10-12).
 * Every drawing that more than one surface uses is stated here once and
 * named; a module that draws it imports the name. `paths.test.ts` fails on
 * a path string written out a second time anywhere in the renderer. One
 * 24 unit square, drawn by `Icon` (or a module's own wrapper) at any size.
 *
 * The generated file-kind art is not here: that is `lib/iconPaths.ts`,
 * emitted by `tools/icons/svg.py`.
 */

const PAGE = 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z'
const PAGE_FOLD = 'M14 3v5h5'

export const PATHS = {
  /** The close and clear cross. */
  close: 'M6 6l12 12M18 6L6 18',
  chevronRight: 'M9 6l6 6-6 6',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronDown: 'M6 9l6 6 6-6',
  /** A menu row's tick, at the menus' 1.7 stroke. */
  tick: 'M5 12.5l4.5 4.5L19 7',
  /** The chosen row of a pick list (sort, player, the phone's tabs). */
  tickWide: 'M4.5 12.5l5 5 10-11',
  /** A theme card's and the first run's chosen mark. */
  check: 'M5 13l4 4L19 7',
  /** The tree's folder silhouette, drawn filled. */
  folderFill: 'M2.5 5.5h6.2l2 2.6h10.8v10.4H2.5z',
  /** The rounded folder outline (a tab, Settings' Explorer rows). */
  folderRound:
    'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z',
  arrowUp: 'm6 10 6-6 6 6M12 4v16',
  drive: 'M3 14h18v5H3zM5 14l2-8h10l2 8M17 16.5h.01',
  /** A page with a folded corner, the outline alone. */
  page: PAGE,
  pageFold: PAGE_FOLD,
  /** The page and its fold as one path. */
  pageFolded: `${PAGE}${PAGE_FOLD}`,
  /** The Properties window's square-cornered sheet. */
  sheet: 'M6 3h8l4 4v14H6z',
  /** Out of the window: a box with an arrow leaving its corner. */
  openOut: 'M14 4h6v6M20 4l-9 9M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6',
  pin: 'M15 3l6 6-3 1-4 4 .5 4.5L10 14l-6 6-1-1 6-6-4.5-4.5L9 8l4-4z',
  /** A shell prompt: a chevron and the cursor line. */
  prompt: 'M5.5 6.5l6 5.5-6 5.5M13.5 18.5H19',
  pencil: 'M4 20h4L19 9l-4-4L4 16z',
  bin: 'M5 7h14M9 7V5h6v2M7 7l1 12h8l1-12M10 11v5M14 11v5',
  speaker: 'M4 9v6h4l5 4V5L8 9H4Z',
  /** The gear's rim and teeth; its hub is a circle, or `gearHub` cut out. */
  gear: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.35.4.64.73.83H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z',
  gearHub: 'M15.2 12a3.2 3.2 0 1 0-6.4 0 3.2 3.2 0 1 0 6.4 0Z'
} as const

export type PathName = keyof typeof PATHS
