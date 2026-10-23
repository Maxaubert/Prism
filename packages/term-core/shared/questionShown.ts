/**
 * What Claude Code's question widget shows (Sonara #323): the text of the
 * question on screen, or the review of the answers after the last one. The
 * renderer reads it off the screen (`questionWidget`), main hands it to
 * Sonara (`sonaraLink`).
 */
export type ShownQuestion = { text: string } | { review: true }

/** A value from the bridge, checked: a question text (capped) or the review. */
export function asShownQuestion(v: unknown): ShownQuestion | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (o.review === true) return { review: true }
  if (typeof o.text === 'string' && o.text.trim() && o.text.length <= 2000) return { text: o.text.trim() }
  return null
}
