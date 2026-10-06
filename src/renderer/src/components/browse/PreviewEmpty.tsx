import type { JSX } from 'react'

/**
 * THE PREVIEW PANE WITH NOTHING IN IT (#300 review; owner, 2026-10-06, of a zip
 * opened from Downloads whose card stayed in the pane beside its own contents:
 * "what should we do about the double view"). Going into a folder or a zip
 * clears the pane but keeps it open at its width, so the list does not jump;
 * it says what to do in plain, quiet words. The first item is never shown on
 * its own: a pick is somebody's, never the app's.
 */
export function PreviewEmpty(): JSX.Element {
  return (
    <div
      data-preview-empty
      className="flex h-full w-full flex-col items-center justify-center gap-2.5 px-6 text-center"
    >
      <svg
        viewBox="0 0 24 24"
        width={28}
        height={28}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="text-[var(--p-dim2)] opacity-60"
      >
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5" />
      </svg>
      <div className="text-xs text-[var(--p-dim)]">Select a file to preview</div>
    </div>
  )
}
