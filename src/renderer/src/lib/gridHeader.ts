// THE SORT STRIP IN A GRID (zoom grid, Stage 4; spec 5.6). The columns mean
// nothing over tiles, so the header band keeps its height and shows the same
// sort buttons packed to the left. This picks which ones, and in what order:
// Name, Date modified, Size, Type; below 360px the lowest priority go first
// (Type, then Size), and Name and Date modified always stay.

/** Under this list width the strip hides Type and Size. */
export const STRIP_NARROW = 360

const ORDER = ['name', 'modified', 'size', 'type']

export function gridHeaderColumns<T extends { key: string }>(columns: readonly T[], width: number): T[] {
  const rank = (key: string): number => {
    const at = ORDER.indexOf(key)
    return at < 0 ? ORDER.length : at
  }
  const narrow = width < STRIP_NARROW
  return columns
    .filter((c) => !narrow || (c.key !== 'type' && c.key !== 'size'))
    .slice()
    .sort((x, y) => rank(x.key) - rank(y.key))
}
