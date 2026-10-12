import type { JSX } from 'react'

/** The panel glyph: a window with its left column ruled off. One drawing for
 *  every place the left panel is pinned or unpinned from (the title bar, the
 *  tab row when the title bar is hidden, and a peeking panel's own header),
 *  so the three read as the same control (#250). */
export function PanelGlyph({ filled = false }: { filled?: boolean }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={15}
      height={15}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      aria-hidden
      data-toggle-glyph={filled ? 'on' : 'off'}
    >
      {filled && (
        <path d="M5 4h4v16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="currentColor" stroke="none" />
      )}
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  )
}

/**
 * One button, one idea: collapse the panel on the left. Over Settings the tree
 * isn't there, so it collapses that page's rail to its glyphs. `open` is the
 * PINNED state: a peek is a pointer convenience and never presses it. Pinned
 * fills the glyph's left column; a pressed toggle is never tinted the accent
 * (owner, 2026-10-12: "filled in like the preview button").
 */
export function PanelToggle({
  open,
  settingsOpen,
  onToggle
}: {
  open: boolean
  settingsOpen: boolean
  onToggle: () => void
}): JSX.Element {
  return (
    <button
      data-panel-toggle
      className="no-drag grid h-7 w-8 shrink-0 place-items-center rounded text-[var(--p-icon)] transition-colors hover:bg-white/10 hover:text-[var(--p-text)]"
      onClick={onToggle}
      title={settingsOpen ? 'Collapse the rail (Ctrl+B)' : 'Files (Ctrl+B)'}
      aria-label={settingsOpen ? 'Collapse the settings rail' : 'Toggle file tree'}
      aria-pressed={open}
    >
      <PanelGlyph filled={open} />
    </button>
  )
}

/** The same glyph in a peeking panel's header: a click keeps the panel open
 *  (pins it), so the content moves over and the peek is over. */
export function PeekPinButton({ onPin }: { onPin: () => void }): JSX.Element {
  return (
    <button
      data-peek-pin
      className="no-drag grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[var(--p-radius-sm)] text-[var(--p-icon)] transition-colors hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]"
      onClick={onPin}
      title="Keep this panel open (Ctrl+B)"
      aria-label="Keep the panel open"
    >
      <PanelGlyph />
    </button>
  )
}
