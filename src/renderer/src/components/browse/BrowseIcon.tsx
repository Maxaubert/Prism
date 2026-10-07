import type { JSX } from 'react'

const paths = {
  back: 'm14 6-6 6 6 6M8 12h12',
  forward: 'm10 6 6 6-6 6M16 12H4',
  up: 'm6 10 6-6 6 6M12 4v16',
  chevron: 'm9 5 7 7-7 7',
  search: 'm20 20-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
  terminal: 'm4 5 6 7-6 7M13 19h7',
  open: 'M13 4h7v7M20 4l-10 10M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
  copy: 'M9 8h10a1 1 0 0 1 1 1v11H9ZM15 4H4v11',
  rename: 'm14 4 6 6M4 20l2-7L17 2l5 5L11 18Z',
  delete: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  home: 'm3 10 9-7 9 7v11h-7v-8h-4v8H3Z',
  drive: 'm5 5-3 10v5h20v-5L19 5ZM2 15h20M6 18h1M10 18h1',
  close: 'm6 6 12 12M6 18 18 6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  folder: 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z',
  cdHere: 'M20 5v7a3 3 0 0 1-3 3H5m4-4-4 4 4 4'
}

export function BrowseIcon({ name }: { name: keyof typeof paths }): JSX.Element {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  )
}

/**
 * THE PREVIEW BUTTON SAYS ITS STATE IN ITS DRAWING (#308; owner, 2026-10-07,
 * of the mockup: "A3"; before it, "the preview panel is almost always opened
 * and that button then is colored ... an icon that changes based on whether
 * the panel is opened or hidden"). A window whose right column is SOLID while
 * the pane is open and EMPTY while it is hidden, in the row's own grey: no
 * accent and no fill in any state. A3's paths and stroke, at the row's size.
 */
export function PreviewGlyph({ open }: { open: boolean }): JSX.Element {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      data-preview-glyph={open ? 'open' : 'hidden'}
      aria-hidden="true"
    >
      {open && <rect x="14.5" y="5" width="5.5" height="14" fill="currentColor" stroke="none" data-preview-column />}
      <path d="M4 5h16v14H4zM14.5 5v14" />
    </svg>
  )
}
