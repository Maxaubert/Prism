import { inOverlay } from './focusGuards'

/** The parts of a keydown the I key reads. */
export interface KeyLike {
  key: string
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
  repeat: boolean
}

/**
 * Does this keydown toggle the photo info card (#78)? The typing guard runs
 * before it, in the viewer's own handler. Out of the component so every
 * guard is pinned (`photoInfoKey.test.ts`):
 * - only where the card is offered (a picture that is a file);
 * - not as a chord, and not on a key repeat (holding I flickered the card);
 * - not over a menu or a dialog (the Properties window is one);
 * - ONLY the front viewer. Every mounted picture listens on the window, and
 *   up to four picture tabs stay mounted, the hidden ones `inert` (as is the
 *   viewer behind a shut preview pane). The card is one setting, so two
 *   mounted pictures flipped it twice and I did nothing (review, 2026-11-01).
 */
export function photoInfoKeyToggles(
  e: KeyLike,
  at: { offered: boolean; target: Element | null; stage: Element | null }
): boolean {
  if (e.key !== 'i' && e.key !== 'I') return false
  if (!at.offered || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return false
  if (inOverlay(at.target)) return false
  return !!at.stage && !at.stage.closest('[inert]')
}
