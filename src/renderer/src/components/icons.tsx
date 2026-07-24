/* eslint-disable react-refresh/only-export-components -- static glyph elements, not components */
import type { JSX, ReactNode } from 'react'

// Shared transport glyphs, so the video and audio players draw the same controls.
// Part of the interchangeable-chrome set (see ROADMAP "Customization & theming").

function Svg({ children, size = 22 }: { children: ReactNode; size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      {children}
    </svg>
  )
}

export const IconPlay = (
  <Svg>
    <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14Z" />
  </Svg>
)
export const IconPause = (
  <Svg>
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </Svg>
)
export const IconVol = (
  <Svg>
    <path d="M4 9v6h4l5 4V5L8 9H4Z" />
    <path d="M16 8.5a4 4 0 0 1 0 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M18.5 6a7 7 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </Svg>
)
export const IconMute = (
  <Svg>
    <path d="M4 9v6h4l5 4V5L8 9H4Z" />
    <path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </Svg>
)
export const IconFull = (
  <Svg>
    <path
      d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
)
