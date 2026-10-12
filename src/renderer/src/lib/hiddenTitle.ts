// A TOOLTIP ONLY WHERE IT ADDS SOMETHING (owner, 2026-10-12: "remove tooltips
// that basically duplicate the text already said"). A name or path drawn whole
// gets no tooltip; one the width cut off gets its whole text back on the
// pointer. Measured on entry, so a resize or a longer text is always right.
// The same shape as prism-term-core's `hiddenTitle` (core 0.34.1).

/** Spread on an element whose own text may be truncated: its title is `text`
 *  while the text is cut off, and absent otherwise. The element must not also
 *  take a `title` prop. */
export function hiddenTitle(text: string | undefined): { onMouseEnter: (e: { currentTarget: HTMLElement }) => void } {
  return {
    onMouseEnter: (e) => {
      const el = e.currentTarget
      if (text && isClipped(el)) el.title = text
      else el.removeAttribute('title')
    }
  }
}

/** Wider content than the box shows (every line here truncates sideways). */
export function isClipped(el: HTMLElement): boolean {
  return el.scrollWidth > el.clientWidth + 0.5
}
