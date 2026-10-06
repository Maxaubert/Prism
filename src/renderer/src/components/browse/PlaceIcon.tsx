import type { JSX } from 'react'
import type { BrowseShortcut } from '@shared/browse'

/**
 * The places panel's line glyphs (#296), drawn from the themes mockup the
 * owner picked (2026-10-06: "with the icons"): one per Windows Known Folder,
 * and the drive. One stroke family, the colour of the row's dim ink.
 */
export type PlaceIconName = NonNullable<BrowseShortcut['known']> | 'drive' | 'usb'

const paths: Record<PlaceIconName, string> = {
  home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z',
  desktop: 'M3 5h18v11H3zM8 20h8M12 16v4',
  downloads: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  documents: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
  pictures: 'M4 5h16v14H4zM8 15l3-3 2 2 3-3 2 2M8.5 9.5h.01',
  music:
    'M9 18V6l11-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM20 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  videos: 'M4 6h12v12H4zM16 10l4-2.5v9L16 14',
  drive: 'M3 14h18v5H3zM5 14l2-8h10l2 8M17 16.5h.01',
  // A removable drive, the drive row mockups' stick (2026-10-06).
  usb: 'M9.5 3h5v5h-5zM7.5 8h9v11a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2zM11 5.5h.01M13 5.5h.01'
}

export function PlaceIcon({ name }: { name: PlaceIconName }): JSX.Element {
  return (
    <svg
      className="browse-place-icon"
      data-place-icon={name}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  )
}
