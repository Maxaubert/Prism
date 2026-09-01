/**
 * The slideshow.
 *
 * Deliberately a VERB OVER THE FOLDER YOU ARE ALREADY IN, not a playlist
 * (2026-08-31). Prism is a viewer, not a library: there is nothing to curate,
 * nothing to save, and nothing that survives the session. It steps the same
 * files the arrows step, in the same order the sort menu decided, and it
 * stops the moment you touch anything.
 *
 * Pure, so the rules can be tested without a timer or a DOM.
 */

/** Seconds a picture stays up. The middle one is the default. */
export const SLIDE_SECONDS = [2, 3, 5, 10, 20] as const
export type SlideSeconds = (typeof SLIDE_SECONDS)[number]

const KEY = 'prism.slideshow.seconds'
export const DEFAULT_SECONDS: SlideSeconds = 5

export function loadSlideSeconds(): SlideSeconds {
  try {
    const n = Number(localStorage.getItem(KEY))
    return (SLIDE_SECONDS as readonly number[]).includes(n) ? (n as SlideSeconds) : DEFAULT_SECONDS
  } catch {
    return DEFAULT_SECONDS
  }
}

export function saveSlideSeconds(n: SlideSeconds): void {
  try {
    localStorage.setItem(KEY, String(n))
  } catch {
    /* no storage: it lasts the session */
  }
}

/**
 * Where the next slide goes.
 *
 * WRAPS, which a slideshow must and the arrow keys must not: arrowing off the
 * end of a folder should stop, because you are looking for a file, while a
 * slideshow that stops after the last picture has ended rather than looped.
 * Returns -1 when there is nothing to show.
 */
export function nextSlide(count: number, at: number): number {
  if (count <= 0) return -1
  if (count === 1) return 0
  return (at + 1) % count
}

/**
 * Should this keypress stop the slideshow?
 *
 * Anything the user does deliberately ends it, because a slideshow that
 * carries on advancing under someone who has started browsing is a picture
 * changing itself while they read. Escape and Space are the explicit way out;
 * everything else that means "I am driving now" counts too.
 */
export function stopsSlideshow(key: string): boolean {
  return (
    key === 'Escape' ||
    key === ' ' ||
    key === 'ArrowLeft' ||
    key === 'ArrowRight' ||
    key === 'ArrowUp' ||
    key === 'ArrowDown' ||
    key === 'Home' ||
    key === 'End' ||
    key === 'PageUp' ||
    key === 'PageDown'
  )
}
