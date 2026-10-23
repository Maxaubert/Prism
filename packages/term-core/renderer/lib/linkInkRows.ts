/**
 * Which rows of the alternate screen the mutation watch inks again (#163).
 * Every row xterm draws through onRender is replaced and then inked there, and
 * most rows hold no link, so "replaced and holds no ink" is nearly every row
 * of every frame, each scanned twice. Only a row that HELD ink and holds none
 * now lost it behind onRender's back (a hover redraw), so only it is inked.
 */
export function rowsToReink<T>(
  mutated: Iterable<T>,
  heldInk: (row: T) => boolean,
  holdsInk: (row: T) => boolean
): T[] {
  const out: T[] = []
  for (const row of mutated) if (heldInk(row) && !holdsInk(row)) out.push(row)
  return out
}
