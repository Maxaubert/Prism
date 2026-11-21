/**
 * Highlight names are per INSTANCE. `CSS.highlights` is one registry for the
 * whole document, so two viewers that paint under the same name wipe each
 * other's ranges. Each find (the document find, a PDF's find) claims a small
 * numbered slot from its own pool and paints under names that carry the number.
 * The stylesheet lists the numbers, so a new instance needs no new CSS.
 */
export const SLOTS = 8

export interface SlotPool {
  /** The lowest free slot, so the numbers stay small and the CSS stays finite. */
  claim(): number
  release(slot: number): void
}

export function slotPool(): SlotPool {
  const taken = new Set<number>()
  return {
    claim() {
      for (let i = 1; i <= SLOTS; i += 1) {
        if (!taken.has(i)) {
          taken.add(i)
          return i
        }
      }
      return 1 // more viewers than panes can exist: share, rather than go unstyled
    },
    release(slot) {
      taken.delete(slot)
    }
  }
}
