/** The widest the scrubber's time label gets (h:mm:ss at 11px with its padding), halved: the label is centred on
 *  the pointer, so this much of it hangs each side. */
export const TIP_HALF_PX = 32

/**
 * Where the scrubber's time label sits (audit #69): the pointer's place along the bar, held far enough in that
 * the centred label stays inside the bar. Unclamped, it hung out of the viewer box at both ends, and the box
 * clips it. A CSS `left` value.
 */
export function tipLeft(frac: number): string {
  const f = Math.max(0, Math.min(1, frac))
  return `clamp(${TIP_HALF_PX}px, ${f * 100}%, calc(100% - ${TIP_HALF_PX}px))`
}