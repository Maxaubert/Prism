/** `v` held within [lo, hi]. When lo > hi, lo wins (a page count of 0 still
 *  lands on page 1). The one copy (structure cleanup, 2026-10-12). */
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
