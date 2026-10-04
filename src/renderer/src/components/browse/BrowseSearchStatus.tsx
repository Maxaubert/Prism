import type { JSX } from 'react'
import type { BrowseSearchState } from './types'

export function BrowseSearchStatus({
  state,
  onCancel,
  onClear
}: {
  state?: BrowseSearchState
  onCancel?: () => void
  /** Back to the folder. The search field this used to be is a popup now
   *  (#267), so the list showing a search says how to leave it. */
  onClear?: () => void
}): JSX.Element {
  const phase = state?.running
    ? 'Searching…'
    : state?.cancelled
      ? 'Search stopped'
      : state?.truncated
        ? 'Search limit reached'
        : 'Search results'
  const details = [
    'This folder and subfolders',
    state?.source === 'everything' ? 'Everything index' : 'Searching folders directly',
    state?.notice,
    state?.unreadable ? `${state.unreadable.toLocaleString()} locations could not be read` : null,
    state?.skippedLinks ? `${state.skippedLinks.toLocaleString()} linked locations skipped` : null,
    state?.truncated ? 'Results are incomplete. Refine your search.' : null
  ]
    .filter(Boolean)
    .join('\n')
  const incomplete = !!(state?.unreadable || state?.skippedLinks)
  return (
    <div
      className="browse-search-status"
      data-testid="browse-search-status"
      data-source={state?.source}
      title={details}
    >
      <span aria-live="polite">
        {phase}
        {state?.notice ? ` · ${state.notice}` : incomplete ? ' · Some locations skipped' : ''}
      </span>
      {state?.running && onCancel && <button onClick={onCancel}>Cancel search</button>}
      {!state?.running && onClear && (
        <button onClick={onClear} data-testid="browse-search-clear">
          Clear search
        </button>
      )}
    </div>
  )
}
