import { useEffect, useRef, type JSX } from 'react'

// The find bar: Prism's own Ctrl+F. A quiet pill in the top corner: query,
// where you are among the matches, step, close. The document-wide counting and
// highlighting live in PdfView; this is just the controls.

export function PdfFindBar({
  query,
  onQuery,
  current,
  total,
  onStep,
  onClose
}: {
  query: string
  onQuery: (q: string) => void
  /** Index of the current match, -1 when there are none. */
  current: number
  total: number
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
      data-owns-escape
      // Opaque on purpose: the bar floats over white pages, and a translucent
      // blur there smears the page edge into a smudge.
      className="absolute right-4 top-3 z-20 flex items-center gap-1 rounded-full border border-[color:var(--p-divider)] bg-[var(--p-title)] py-1 pl-3 pr-1 shadow-[0_8px_24px_rgba(0,0,0,.45)]"
    >
      <input
        ref={input}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onStep(e.shiftKey ? -1 : 1)
          } else if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
        placeholder="Find in document"
        aria-label="Find in document"
        className="w-44 bg-transparent text-[12.5px] text-[var(--p-text)] outline-none placeholder:text-[var(--p-dim2)]"
      />
      <span className="min-w-[3.4rem] text-right text-[11.5px] tabular-nums text-[var(--p-dim)]">
        {total ? `${current + 1} / ${total}` : query ? '0 / 0' : ''}
      </span>
      <button
        className="grid h-7 w-7 place-items-center rounded-full text-[var(--p-icon)] hover:bg-white/10 hover:text-[var(--p-text)] disabled:opacity-40"
        onClick={() => onStep(-1)}
        disabled={!total}
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
      >
        <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 14.5l6-6 6 6" />
        </svg>
      </button>
      <button
        className="grid h-7 w-7 place-items-center rounded-full text-[var(--p-icon)] hover:bg-white/10 hover:text-[var(--p-text)] disabled:opacity-40"
        onClick={() => onStep(1)}
        disabled={!total}
        title="Next match (Enter)"
        aria-label="Next match"
      >
        <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 9.5l6 6 6-6" />
        </svg>
      </button>
      <button
        className="grid h-7 w-7 place-items-center rounded-full text-[var(--p-icon)] hover:bg-white/10 hover:text-[var(--p-text)]"
        onClick={onClose}
        title="Close (Esc)"
        aria-label="Close find"
      >
        <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  )
}
