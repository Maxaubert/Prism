import type { KeyboardEvent } from 'react'

// The find bar's words and keys (#524), apart from the component so both are plain functions.

/** The counter: "2 of 5", "none" for a query nothing matches, empty with no query. */
export function findStatus(query: string, count: number, at: number): string {
  if (!query) return ''
  return count ? `${at + 1} of ${count}` : 'none'
}

/**
 * The bar's keys. EVERY key stops here, so a letter typed into the field never
 * reaches an app shortcut behind it (the PDF bar let all but Enter and Escape
 * through). F3 steps like Enter, so the PDF's own F3 key, which would have\r\n * bubbled, is not needed while the field has the focus.
 */
export function findKey(
  e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'stopPropagation' | 'preventDefault'>,
  step: (delta: number) => void,
  close: () => void
): void {
  e.stopPropagation()
  if (e.key === 'Escape') close()
  else if (e.key === 'Enter' || e.key === 'F3') {
    e.preventDefault()
    step(e.shiftKey ? -1 : 1)
  }
}
