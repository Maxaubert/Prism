import { contrastOf } from '../fieldColours'

/**
 * THE CARD'S OWN BOX IS ONE DARK GREY FOR EVERY THEME (owner, 2026-10-06:
 * "give all the same coloured box for the card, make it some dark grey"). The
 * frame and the name band are the CARD, the same on all 18 themes and on own
 * copies; only the mini Explorer inside wears the theme. Fixed rather than
 * read off the page, so the wall reads as one grid of like boxes whichever
 * theme is current: dark enough to frame a light preview on a light page,
 * light enough to stand off a black one. `cardBox.test.ts` holds the floors.
 */
export const CARD_BOX = '#2b2c30'
/** The frame under the pointer or the keyboard: a step lighter. */
export const CARD_BOX_HI = '#55575e'
/** The name on the band. */
export const CARD_TEXT = '#e6e6e9'

/** The chosen card's check: the theme's own accent where it reads on the
 *  grey (3:1, a mark, not text), else the band's text. */
export const cardCheck = (accent: string): string => (contrastOf(accent, CARD_BOX) >= 3 ? accent : CARD_TEXT)
