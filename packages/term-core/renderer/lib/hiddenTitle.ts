/** A tooltip that says only what the eye cannot read. Owner, 2026-10-12:
 *  "remove unnecessary tooltips ... tooltips that basically just repeat what's
 *  said, those are useless". A label's own words come up on hover only when
 *  they are not on screen whole: cut by an ellipsis, or hidden by a narrow
 *  layout (the settings rail folds to its icons). */

/** The parts of an element the check reads; a plain object in the tests. */
export interface TitleTarget {
  scrollWidth: number
  clientWidth: number
  innerText: string
  title: string
}

/** True when `text` is not all visible in `el`. innerText leaves out what
 *  display:none hides; scrollWidth past clientWidth is an ellipsis at work. */
export function textHidden(el: Omit<TitleTarget, 'title'>, text: string): boolean {
  return el.scrollWidth > el.clientWidth || !el.innerText.includes(text)
}

/** Props for the element that shows `text`: its title is set as the pointer
 *  arrives, so it follows the width the element has then. */
export function hiddenTitle(text: string): { onMouseEnter: (e: { currentTarget: TitleTarget }) => void } {
  return {
    onMouseEnter: (e) => {
      const el = e.currentTarget
      el.title = textHidden(el, text) ? text : ''
    }
  }
}
