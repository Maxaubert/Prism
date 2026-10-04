import { useEffect, useId, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { FolderIcon, KindIcon, iconColour } from '../TreeRows'
import { hitFolder, stepActive } from '@shared/searchSuggest'
import { useSearchSuggestions, type Suggestion } from '../../lib/useSearchSuggestions'
import { BrowseIcon } from './BrowseIcon'
import './search-popup.css'

/**
 * SEARCH IS A POPUP (#267; owner, 2026-10-04, showing PowerToys Run: "the
 * search field should be a search icon only that displays a search pop up on
 * click like this but centered on screen and blurred background behind ... in
 * the search pop up you'll see the relevant recommendations, the most likely
 * ones, and at the bottom there's a show more which essentially does a normal
 * search like before where you can see all files that were found").
 *
 * The focus never leaves the field: the rows are a listbox the field points
 * into (aria-activedescendant), so every key is the field's and Tab has
 * nowhere else to go. Nothing is marked until the arrows or the pointer pick a
 * row, so Enter on a bare query runs the full search rather than opening a
 * file nobody chose.
 */
export function BrowseSearchPopup(props: {
  tabId?: string
  directory: string
  initialQuery: string
  /** Open a hit: a file opens as a plain open does, a folder is gone into. */
  onPick: (hit: Suggestion) => void
  /** "Show more": the list's own full search for this query. */
  onShowAll: (query: string) => void
  onClose: () => void
}): JSX.Element {
  const [query, setQuery] = useState(props.initialQuery)
  const field = useRef<HTMLInputElement>(null)
  const id = useId()
  const answer = useSearchSuggestions(props.tabId, props.directory, query)
  const hits = answer.hits
  // The marked row belongs to the list it was marked in, and to the words:
  // a new answer is a new list, and a letter typed is a new question even
  // while the old rows stay on screen waiting for its answer, so Enter then
  // runs the search rather than opening a row picked for the text before
  // (review of #268). So every edit of the field takes the mark away.
  const [mark, setMark] = useState<{ list: unknown; at: number }>({ list: null, at: -1 })
  const active = mark.list === hits ? mark.at : -1
  const setActive = (at: number | ((previous: number) => number)): void =>
    setMark({ list: hits, at: typeof at === 'function' ? at(active) : at })
  const showMore = !!query.trim()
  const optionId = (index: number): string => `${id}-option-${index}`

  useLayoutEffect(() => {
    field.current?.focus()
    field.current?.select()
  }, [])
  const close = useRef(props.onClose)
  useEffect(() => {
    close.current = props.onClose
  })

  const open = (index: number): void => {
    if (index >= 0 && index < hits.length) props.onPick(hits[index])
    else if (query.trim()) props.onShowAll(query)
  }
  const status = !query.trim()
    ? ''
    : answer.running && !hits.length
      ? 'Searching'
      : hits.length
        ? `${hits.length} ${hits.length === 1 ? 'match' : 'matches'}${answer.more ? ', more with Show more' : ''}`
        : 'No matches in this folder or its subfolders'

  return createPortal(
    // data-owns-escape: App's capture-phase Escape stands down while it is up.
    <div
      data-owns-escape
      data-search-popup
      className="browse-search-scrim"
      role="presentation"
      onMouseDown={() => close.current()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search this folder and subfolders"
        className="browse-search-popup"
        data-testid="browse-search-popup"
        onMouseDown={(e) => {
          e.stopPropagation()
          // The field keeps the focus wherever the popup is pressed: a press
          // on its magnifier, its padding or the empty line used to blur it to
          // the page, where no key of the popup's was heard any more and
          // Ctrl+T or Ctrl+W reached the tabs underneath (review of #268,
          // measured). The rows already do this; the field itself may take it.
          if (e.target !== field.current) e.preventDefault()
        }}
      >
        <div className="browse-search-popup-field">
          <BrowseIcon name="search" />
          <input
            ref={field}
            role="combobox"
            aria-expanded={hits.length > 0 || showMore}
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            aria-label="Search this folder and subfolders"
            placeholder="Search this folder and subfolders"
            title={
              'Words, "phrases", *.mp4, folder: music, file: notes, ext:mp4;mkv\nEverything search syntax is available when Everything is running.'
            }
            spellCheck={false}
            autoComplete="off"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setMark({ list: null, at: -1 })
            }}
            onKeyDown={(e) => {
              // Every key in here is the popup's: the Explorer and the app
              // must not walk rows or close tabs underneath it.
              e.stopPropagation()
              if (e.key === 'Escape') {
                e.preventDefault()
                close.current()
              } else if (e.key === 'Tab') {
                e.preventDefault()
              } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((at) => stepActive(at, hits.length, e.key === 'ArrowDown' ? 1 : -1, showMore))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                if (e.ctrlKey) {
                  if (query.trim()) props.onShowAll(query)
                } else open(active)
              }
            }}
          />
          {answer.running && !!query.trim() && <span className="browse-search-popup-spin" aria-hidden />}
        </div>
        {showMore && !answer.running && !hits.length && (
          <p className="browse-search-popup-empty">No names match here. Show more searches everything.</p>
        )}
        {showMore && (
          <ul id={`${id}-list`} role="listbox" aria-label="Likely matches" className="browse-search-popup-list">
            {hits.map((hit, index) => (
              <li
                key={hit.path}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                data-active={index === active || undefined}
                data-hit-path={hit.path}
                title={hit.path}
                className="browse-search-popup-row"
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => index !== active && setActive(index)}
                onClick={() => props.onPick(hit)}
              >
                {hit.isFolder ? (
                  <FolderIcon color="var(--p-tree-folder)" />
                ) : (
                  hit.file && (
                    <KindIcon
                      kind={hit.file.kind}
                      ext={hit.file.ext}
                      name={hit.name}
                      color={iconColour(hit.file.kind)}
                      size={16}
                      bg="var(--p-side-flat)"
                    />
                  )
                )}
                <span className="browse-search-popup-name">{hit.name}</span>
                <span className="browse-search-popup-where">{hitFolder(hit.path, props.directory)}</span>
              </li>
            ))}
            <li
              id={optionId(hits.length)}
              role="option"
              aria-selected={active === hits.length}
              data-active={active === hits.length || undefined}
              data-show-more
              className="browse-search-popup-more"
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => active !== hits.length && setActive(hits.length)}
              onClick={() => props.onShowAll(query)}
            >
              <span>Show more</span>
              <span className="browse-search-popup-key" aria-hidden>
                Ctrl+Enter
              </span>
            </li>
          </ul>
        )}
        <div className="sr-only" role="status" aria-live="polite">
          {status}
        </div>
      </div>
    </div>,
    document.body
  )
}
