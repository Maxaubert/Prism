import type { CSSProperties } from 'react'

/**
 * How a virtual list's row or tile layer is moved down to its first mounted
 * line. A transform is cheapest, but a text field inside a transformed layer
 * puts the caret where screen magnifiers cannot follow it (e2e caretTracks,
 * #523). While a rename field is open the layer moves by 	op instead:
 * the same place on screen, no transform above the field.
 */
export function layerShift(y: number, field: boolean): CSSProperties {
  return field ? { position: 'relative', top: y } : { transform: `translateY(${y}px)` }
}