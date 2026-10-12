import type { JSX } from 'react'
import { Icon } from '../icons/Icon'
import { PATHS } from '../icons/paths'

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
      <Icon size={28} weight="1.5" className="text-[var(--p-dim2)] opacity-60">
        <path d={PATHS.page} />
        <path d={PATHS.pageFold} />
      </Icon>
      <div className="text-xs text-[var(--p-dim)]">Select a file to preview</div>
    </div>
  )
}
