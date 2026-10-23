import { useEffect, useRef, useState, type JSX } from 'react'
import { clearTermFind, findInTerm, onTermFindResults } from './TerminalPanel'
import { LAYER } from './layers'

/**
 * Find in the terminal's scrollback (Ctrl+F, Ctrl+Shift+F everywhere; 2026-08-31, Ctrl+F since 2026-09-23).
 *
 * Ten thousand lines of an agent's answer, and until now the only way back
 * to something it said was to scroll. This is DocFind's bar over the
 * terminal, but the search itself is xterm's own: it knows about wrapped
 * lines, the alternate screen and the scrollback buffer, none of which a DOM
 * search over the rendered rows would.
 *
 * It lives behind the same lazy chunk as TerminalPanel, so importing the
 * session functions here costs the launch bundle nothing.
 */
export default function TermFind({
  sessionId,
  onClose
}: {
  sessionId: string
  onClose: () => void
}): JSX.Element {
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState({ index: -1, count: 0 })

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  useEffect(() => onTermFindResults(sessionId, setHits), [sessionId])

  // The highlights are the terminal's, not this component's: leaving without
  // clearing them would decorate a shell nobody is searching any more.
  useEffect(() => () => clearTermFind(sessionId), [sessionId])

  const step = (dir: 1 | -1): void => {
    findInTerm(sessionId, query, dir)
  }

  // -1 means xterm stopped counting: over its threshold there ARE matches,
  // and saying "none" would be a lie about a search that is working.
  const readout = !query
    ? ''
    : hits.count === 0
      ? 'none'
      : hits.index < 0
        ? `${hits.count}+`
        : `${hits.index + 1} of ${hits.count}`

  // NO SHADOW (owner, 2026-09-23: "remove also the shadow from behind the
  // search box"): its border already lifts it off the terminal, and the shadow
  // read as a dark halo over the text, as it did round the help popup.
  return (
    <div
      data-term-find
      data-owns-escape
      className={`absolute right-3 top-3 ${LAYER.panel} flex items-center gap-1.5 rounded-[var(--p-radius-sm)] border border-[color:var(--p-divider)] bg-[var(--p-side-flat)] px-2 py-1`}
    >
      <input
        ref={input}
        value={query}
        spellCheck={false}
        placeholder="Find in terminal"
        aria-label="Find in terminal"
        className="w-[180px] bg-transparent text-[12px] text-[var(--p-text)] outline-none placeholder:text-[var(--p-dim2)]"
        onChange={(e) => {
          setQuery(e.target.value)
          // Incremental while typing, so the view does not leap down the
          // scrollback one character at a time.
          findInTerm(sessionId, e.target.value, 1, true)
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') onClose()
          else if (e.key === 'Enter') step(e.shiftKey ? -1 : 1)
        }}
      />
      <span className="min-w-[52px] shrink-0 text-right text-[11px] tabular-nums text-[var(--p-dim2)]">
        {readout}
      </span>
      <button
        aria-label="Previous match"
        disabled={!hits.count}
        className="grid h-5 w-5 place-items-center rounded text-[var(--p-icon)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)] disabled:opacity-40"
        onClick={() => step(-1)}
      >
        <svg
          viewBox="0 0 24 24"
          width={12}
          height={12}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M18 15l-6-6-6 6" />
        </svg>
      </button>
      <button
        aria-label="Next match"
        disabled={!hits.count}
        className="grid h-5 w-5 place-items-center rounded text-[var(--p-icon)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)] disabled:opacity-40"
        onClick={() => step(1)}
      >
        <svg
          viewBox="0 0 24 24"
          width={12}
          height={12}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <button
        aria-label="Close find"
        className="grid h-5 w-5 place-items-center rounded text-[var(--p-icon)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]"
        onClick={onClose}
      >
        <svg
          viewBox="0 0 24 24"
          width={12}
          height={12}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  )
}
