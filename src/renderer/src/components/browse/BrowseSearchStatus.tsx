import type { JSX } from 'react'
import type { BrowseSearchState } from './types'

export function BrowseSearchStatus({
  state,
  onCancel
}: {
  state?: BrowseSearchState
  onCancel?: () => void
}): JSX.Element {
  const phase = state?.running
    ? 'Searching'
    : state?.cancelled
      ? 'Search stopped'
      : state?.truncated
        ? 'Search limit reached'
        : 'Search results'
  return (
    <div className="browse-search-status" data-testid="browse-search-status">
      <div role="status" aria-live="polite">
        <span>{phase} · This folder and subfolders</span>
        {state && (
          <span className="browse-search-detail">
            {state.scanned.toLocaleString()} items checked
          </span>
        )}
        {!!state?.unreadable && (
          <span className="browse-search-detail">
            {state.unreadable.toLocaleString()} folders could not be read
          </span>
        )}
        {!!state?.skippedLinks && (
          <span className="browse-search-detail">
            {state.skippedLinks.toLocaleString()} linked locations skipped
          </span>
        )}
        {state?.truncated && (
          <span className="browse-search-detail">
            Results are incomplete. Use a more specific name or search a smaller folder.
          </span>
        )}
      </div>
      {state?.running && onCancel && <button onClick={onCancel}>Cancel search</button>}
    </div>
  )
}
