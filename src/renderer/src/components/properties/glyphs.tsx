import type { JSX, ReactNode } from 'react'

// The Properties window's own glyphs, drawn in the approved mockup's stroke
// family (2026-10-12, `research/prism/mockups/2026-10-12-properties/final`):
// 1.6 for the header pictures, 1.7 for the small buttons, as FileMenuIcon.

function Glyph({
  size,
  width = 1.6,
  children
}: {
  size: number
  width?: number
  children: ReactNode
}): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="block shrink-0"
    >
      {children}
    </svg>
  )
}

export function DriveGlyph(): JSX.Element {
  return (
    <Glyph size={22}>
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M5 13l2.5-7h9L19 13" />
      <circle cx="17" cy="16.5" r=".9" fill="currentColor" />
    </Glyph>
  )
}

export function FolderGlyph(): JSX.Element {
  return (
    <Glyph size={22}>
      <path d="M3 7.5V18a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 18V9.5A1.5 1.5 0 0 0 19.5 8H12l-2-2.5H4.5A1.5 1.5 0 0 0 3 7z" />
    </Glyph>
  )
}

export function FileGlyph(): JSX.Element {
  return (
    <Glyph size={22}>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
    </Glyph>
  )
}

export function CodeGlyph(): JSX.Element {
  return (
    <Glyph size={22}>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M10 12l-2 2 2 2M14 12l2 2-2 2" />
    </Glyph>
  )
}

export function CopyGlyph(): JSX.Element {
  return (
    <Glyph size={14} width={1.7}>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" />
    </Glyph>
  )
}

export function CheckGlyph(): JSX.Element {
  return (
    <Glyph size={14} width={2}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </Glyph>
  )
}

/** A song with no cover of its own (owner, 2026-10-12: "D. Sound bars
 *  instead of a note this is good"). */
export function SoundBarsGlyph(): JSX.Element {
  return (
    <Glyph size={46} width={1.9}>
      <path d="M4 10v4M7.5 7v10M11 4.5v15M14.5 8v8M18 10.5v3M21 11.5v1" />
    </Glyph>
  )
}
