import { useEffect, useRef, type JSX } from 'react'
import { findKey, findStatus } from '../lib/findBarKeys'
import { Icon } from './icons/Icon'

// The one find bar (#524; its words and keys are lib/findBarKeys.ts): the controls of Ctrl+F in a PDF and in the other
// documents (DocFind), in DocFind's words and box. It counts and highlights
// nothing; the viewer around it does.

export function FindBar({
  query,
  onQuery,
  count,
  at,
  onStep,
  onClose
}: {
  query: string
  onQuery: (q: string) => void
  count: number
  /** Index of the current match, -1 when there are none. */
  at: number
  onStep: (delta: number) => void
  onClose: () => void
}): JSX.Element {
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  return (
    <div
      data-find-bar
      data-owns-escape
      // Opaque on purpose (side-flat: --p-title is translucent on glass
      // styles): the bar floats over white pages, and anything see-through
      // there smears the page edge into a smudge.
      className="absolute right-3 top-3 z-30 flex items-center gap-1.5 rounded-[var(--p-radius-sm)] border border-[color:var(--p-divider)] bg-[var(--p-side-flat)] px-2 py-1 shadow-[0_10px_28px_rgba(0,0,0,.45)]"
    >
      <input
        ref={input}
        value={query}
        spellCheck={false}
        placeholder="Find"
        aria-label="Find in document"
        className="w-[180px] bg-transparent text-[12px] text-[var(--p-text)] outline-none placeholder:text-[var(--p-dim2)]"
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => findKey(e, onStep, onClose)}
      />
      <span className="min-w-[52px] shrink-0 text-right text-[11px] tabular-nums text-[var(--p-dim2)]">
        {findStatus(query, count, at)}
      </span>
      <button
        aria-label="Previous match"
        title="Previous match (Shift+Enter)"
        disabled={!count}
        className="grid h-5 w-5 place-items-center rounded text-[var(--p-icon)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)] disabled:opacity-40"
        onClick={() => onStep(-1)}
      >
        <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
          <path d="M18 15l-6-6-6 6" />
        </svg>
      </button>
      <button
        aria-label="Next match"
        title="Next match (Enter)"
        disabled={!count}
        className="grid h-5 w-5 place-items-center rounded text-[var(--p-icon)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)] disabled:opacity-40"
        onClick={() => onStep(1)}
      >
        <Icon name="chevronDown" size={12} weight="2.2" join={false} />
      </button>
      <button
        aria-label="Close find"
        title="Close (Esc)"
        className="grid h-5 w-5 place-items-center rounded text-[var(--p-icon)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]"
        onClick={onClose}
      >
        <Icon name="close" size={12} weight="2.2" join={false} />
      </button>
    </div>
  )
}