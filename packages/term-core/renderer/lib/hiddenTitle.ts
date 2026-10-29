/** A tooltip that says only what the eye cannot read. Owner, 2026-10-12:
 *  "remove unnecessary tooltips ... tooltips that basically just repeat what's
 *  said, those are useless". A label's own words come up on hover only when
 *  they are not on screen whole: cut by an ellipsis, or hidden by a narrow
 *  layout (the settings rail folds to its icons).
 *
 *  The one copy (2026-10-28): the app's Explorer rows, crumbs and properties
 *  had their own from when the core lived in another repo. Theirs brought the
 *  sub-pixel tolerance, an absent text, and taking the attribute away. */

/** The parts of an element the check reads; a plain object in the tests. */
export interface TitleTarget {
  scrollWidth: number
  clientWidth: number
  innerText: string
  title: string
  removeAttribute(name: 'title'): void
}

/** Wider content than the box shows (every line here truncates sideways).
 *  Half a pixel of rounding is not a cut. */
export function isClipped(el: Pick<TitleTarget, 'scrollWidth' | 'clientWidth'>): boolean {
  return el.scrollWidth > el.clientWidth + 0.5
}

/** True when `text` is not all visible in `el`. innerText leaves out what
 *  display:none hides, and folds runs of white space into one, so the text is
 *  folded the same way before it is looked for; scrollWidth past clientWidth
 *  is an ellipsis at work. */
export function textHidden(el: Omit<TitleTarget, 'title' | 'removeAttribute'>, text: string): boolean {
  return isClipped(el) || !el.innerText.includes(text.replace(/\s+/g, ' '))
}

/** Props for the element that shows `text`: its title is set as the pointer
 *  arrives, so it follows the width the element has then, and is taken away
 *  while the text is all there. The element must not also take a `title`
 *  prop. */
export function hiddenTitle(text: string | undefined): { onMouseEnter: (e: { currentTarget: TitleTarget }) => void } {
  return {
    onMouseEnter: (e) => {
      const el = e.currentTarget
      if (text && textHidden(el, text)) el.title = text
      else el.removeAttribute('title')
    }
  }
}
