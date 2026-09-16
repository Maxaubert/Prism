import type { JSX } from 'react'

const paths = {
  open: 'M14 4h6v6M20 4l-9 9M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6',
  project: 'M3 7h6l2 3h10v10H3zM14 3h7v7M21 3l-7 7',
  'new-tab': 'M4 6h10v12H4zM14 6h6v12h-6M17 9v6M14 12h6',
  split: 'M4 5h16v14H4zM13 5v14',
  cut: 'M9.2 4.5L14.5 12m0 0l4.3 6M14.5 12l4.3-6M14.5 12l-4.3 6M6 6.2a1.8 1.8 0 1 0 .01 0M6 17.8a1.8 1.8 0 1 0 .01 0',
  copy: 'M8 8h12v12H8zM16 8V4H4v12h4',
  paste: 'M9 3.5h6v3H9zM7 5H4.5v15.5h15V5H17',
  rename: 'M4 20h4L19 9l-4-4L4 16z',
  delete: 'M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13',
  duplicate: 'M8 8h12v12H8zM16 8V4H4v12h4M14 11v6M11 14h6',
  folder: 'M2.5 5.5h6.2l2 2.6h10.8v10.4H2.5z',
  path: 'M9 15l6-6M7.5 10.5l-2 2a3.5 3.5 0 0 0 5 5l2-2M16.5 13.5l2-2a3.5 3.5 0 0 0-5-5l-2 2',
  properties: 'M12 8.2v.01M12 11v5M3.8 12a8.2 8.2 0 1 0 16.4 0 8.2 8.2 0 0 0-16.4 0z',
  terminal: 'M5.5 6.5l6 5.5-6 5.5M13.5 18.5H19',
  pin: 'M15 3l6 6-3 1-4 4 .5 4.5L10 14l-6 6-1-1 6-6-4.5-4.5L9 8l4-4z',
  unpin: 'M15 3l6 6-3 1-4 4M10 14l-6 6M3 3l18 18M9 8l4-4',
  up: 'm6 10 6-6 6 6M12 4v16',
  down: 'm6 14 6 6 6-6M12 20V4',
  'open-with': 'M14 4h6v6M20 4l-9 9M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6',
  'default-app': 'M12 3l8 5-8 5-8-5 8-5zM4 13l8 5 8-5'
}

export type FileMenuIconName = keyof typeof paths

/** Shared action glyphs for Explorer and project file menus. */
export function FileMenuIcon({ name }: { name: FileMenuIconName }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={13}
      height={13}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 opacity-80"
      aria-hidden
      data-file-menu-icon={name}
    >
      <path d={paths[name]} />
    </svg>
  )
}
