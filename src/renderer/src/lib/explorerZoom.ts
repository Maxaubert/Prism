import { createPref } from './prefs/createPref'
import { EXPLORER_SIZES, explorerSizeOf, type ExplorerRow, type ExplorerSize } from './explorerSize'

// HOW BIG THE EXPLORER IS, AS ONE STEP (owner, 2026-11-09: "ctrl scroll to
// adjust the size of the list view", "smooth, like Explorer", "one size
// everywhere"). Ctrl+wheel moves a single step number that every folder wears
// and a restart keeps. Steps 0 to 2 are the three Settings sizes exactly;
// 3 and 4 are roomier rows whose icon becomes a picture; 5 to 9 are a grid of
// tiles. A step is one look, never a row stretched round small text (the rule
// in explorerSize.ts).

export interface ZoomLook extends ExplorerRow {
  kind: 'row' | 'tile'
  /** The picture's edge in px at a ROW step; 0 while the row shows an icon. */
  thumb: number
  /** A TILE step's picture edge in px; 0 at a row step. */
  edge: number
  /** A tile's name text size; 0 at a row step. */
  tileFont: number
}

const sized = (id: ExplorerSize): ZoomLook => ({
  ...(EXPLORER_SIZES.find((s) => s.id === id) ?? EXPLORER_SIZES[1]).row,
  kind: 'row',
  thumb: 0,
  edge: 0,
  tileFont: 0
})

const LARGE_ROW = sized('large')

/** A tile step. Its row fields stay Large's: a listing that cannot be a grid
 *  (a search, an archive, This PC) keeps rows at a tile step, 40px ones. */
const tile = (edge: number, tileFont: number): ZoomLook => ({ ...LARGE_ROW, kind: 'tile', edge, tileFont })

export const ZOOM_STEPS: ZoomLook[] = [
  sized('small'),
  sized('medium'),
  sized('large'),
  // Roomy and Roomier: the icon takes the room a picture will, the text stays
  // a size that reads (13px), the padding follows Large's.
  { kind: 'row', height: 56, font: 13, icon: 28, gap: 14, padX: 16, thumb: 40, edge: 0, tileFont: 0 },
  { kind: 'row', height: 76, font: 13, icon: 40, gap: 16, padX: 16, thumb: 60, edge: 0, tileFont: 0 },
  tile(96, 11.5),
  tile(128, 12),
  tile(168, 12.5),
  tile(216, 13),
  tile(272, 13)
]

/** The last step a person can reach. The grid is built but stays behind this
 *  until its sweep, drag and rename are done (Stage 6 flips it to 9). */
export const ZOOM_MAX_AVAILABLE = 4

/** TEST ONLY: a number from 5 to 9 under this localStorage key lifts the
 *  ceiling to it, so the unit and e2e runs can reach the tiles. Nothing in the
 *  app writes it, and it goes when the grid ships. */
export const ZOOM_CEILING_KEY = 'prism.explorer.zoomMax'

/** The last step a person can reach right now. */
export function zoomCeiling(): number {
  try {
    const n = Number(localStorage.getItem(ZOOM_CEILING_KEY))
    if (Number.isInteger(n) && n > ZOOM_MAX_AVAILABLE && n < ZOOM_STEPS.length) return n
  } catch {
    /* a blocked store is the shipped ceiling */
  }
  return ZOOM_MAX_AVAILABLE
}

const DEFAULT_STEP = 1

const clampStep = (n: number): number => Math.min(zoomCeiling(), Math.max(0, n))

/** A stored step, made safe: a whole number is clamped, anything else is
 *  `fallback` (the step the old size choice stands for, else Medium). */
export function zoomStepOf(raw: unknown, fallback: number = DEFAULT_STEP): number {
  if (typeof raw !== 'string' || !raw.trim()) return fallback
  const n = Number(raw)
  return Number.isInteger(n) ? clampStep(n) : fallback
}

/** What the old three-way choice stands for as a step, so nobody's size
 *  changes on update. Read straight from storage: it is only ever the seed. */
function seedFromSize(): number {
  try {
    const id = explorerSizeOf(localStorage.getItem('prism.explorer.size'))
    return EXPLORER_SIZES.findIndex((s) => s.id === id)
  } catch {
    return DEFAULT_STEP
  }
}

const pref = createPref<number>({
  key: 'prism.explorer.zoom',
  parse: (raw) => zoomStepOf(raw, seedFromSize()),
  fallback: DEFAULT_STEP
})

export const explorerZoom = pref.get
export const useExplorerZoom = pref.use
export const reloadExplorerZoom = pref.reload
export const setExplorerZoom = (step: number): void => pref.set(clampStep(Math.round(step)))

export const zoomIn = (step: number): number => clampStep(step + 1)
export const zoomOut = (step: number): number => clampStep(step - 1)

/** The look of a step; a step out of range is the nearest one. */
export function atStep(step: number): ZoomLook {
  return ZOOM_STEPS[clampStep(Math.round(step))]
}

/** The Settings size a step stands for: the header band and Quick access keep
 *  Large's look from step 2 up (a sidebar of 76px rows would be absurd). */
export function headSizeOf(step: number): ExplorerSize {
  return EXPLORER_SIZES[Math.min(EXPLORER_SIZES.length - 1, Math.max(0, step))].id
}
