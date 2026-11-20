/**
 * The classes the preview window takes from the page's <html> and <body> (audit #60). One is left out:
 * `p-overlay-scrollbars` hides the native scrollbars on the promise that the page's OverlayScrollbars draws its
 * own, but that component listens on the opener's document only. In the preview window nothing would be drawn, so
 * the native bars stay.
 */
export const NOT_MIRRORED = ['p-overlay-scrollbars']

export function previewClass(value: string): string {
  return value
    .split(/\s+/)
    .filter((c) => c && !NOT_MIRRORED.includes(c))
    .join(' ')
}