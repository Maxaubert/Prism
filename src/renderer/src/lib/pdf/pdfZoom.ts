/**
 * What "100%" means for a PDF (2026-08-31).
 *
 * It used to mean 1.9 pdf.js units flat - one PDF point per CSS pixel, times
 * 1.9, because 1.0 reads small on a modern screen. That is fine for the US
 * Letter and A4 documents almost everything is, and wrong for anything else:
 * pdf.js units are relative to the page's OWN size, so "100%" was really
 * "1.9x whatever this document happens to measure".
 *
 * MEASURED on an artbook whose pages are about 1800pt wide: at that 100% it
 * rendered 3462 CSS px across, three times a letter page's 1163, and read as
 * the viewer being broken rather than as the pages being big.
 *
 * So 100% is now a fixed WIDTH ON SCREEN, and the scale that achieves it is
 * derived per document. A letter page still lands at exactly 1.9, so nothing
 * changes for the documents that were already right.
 */

/** The width a page occupies at 100%, in CSS px: US Letter at the old 1.9
 *  baseline. Keeping this number is what makes the common case identical. */
export const PAGE_100_PX = 612 * 1.9

/** Never magnify a small page more than this. A 200pt receipt stretched to
 *  the full width would be a 5.8x blow-up of a page that has no detail to
 *  show at that size, so "the same width as everything else" stops being
 *  worth having and it is left smaller instead. */
export const MAX_BASE = 3

/** Never shrink a huge page below this, so a plan or a poster still opens as
 *  something rather than as a stamp. */
export const MIN_BASE = 0.1

/**
 * The pdf.js scale this document calls 100%, from its first page's width in
 * points. Falls back to the old flat baseline for a width that makes no
 * sense, which is what a document reports before page one has loaded.
 */
export function baseZoom(pageWidthPt: number): number {
  if (!Number.isFinite(pageWidthPt) || pageWidthPt <= 0) return 1.9
  return Math.min(MAX_BASE, Math.max(MIN_BASE, PAGE_100_PX / pageWidthPt))
}

/** What the pill shows, given a pdf.js scale and the document's base. */
export function zoomPercent(scale: number, base: number): number {
  if (!(base > 0)) return 100
  return Math.round((scale / base) * 100)
}

/** The page's side gutter at its widest, in px. */
export const PAD_X_MAX = 48
/** The lowest scale a FIT may reach. The zoom buttons stop at 0.25, but a fit in a very narrow pane must go lower,
 *  or the page stays wider than the pane and the opening centre never happens (audit #83). */
export const FIT_FLOOR = 0.05

/** The side gutter for a scroll box this wide: 48 px, less in a narrow pane, where 96 px of gutter left no room
 *  for the page (audit #83). A box of 800 px or more keeps 48. */
export function padXFor(boxW: number): number {
  return Math.max(8, Math.min(PAD_X_MAX, Math.floor(boxW * 0.06)))
}

/** The scale that fits the page to the width, or to the whole box, with a pixel of slack (rounding anywhere
 *  would otherwise show a scrollbar for one pixel of overflow). */
export function fitScale(
  mode: 'fit-width' | 'fit-page' | 'manual',
  box: { w: number; h: number },
  page: { w: number; h: number },
  padY: number,
  min: number,
  max: number
): number {
  const availW = box.w - padXFor(box.w) * 2 - 1
  const availH = box.h - padY * 2
  const fit = mode === 'fit-width' ? availW / page.w : Math.min(availW / page.w, availH / page.h)
  return Math.max(min, Math.min(max, fit))
}