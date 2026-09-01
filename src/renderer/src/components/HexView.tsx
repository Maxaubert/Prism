import { useEffect, useState, type JSX } from 'react'
import {
  clampPage,
  hexRows,
  offsetLabel,
  PAGE_BYTES,
  pageCount,
  pageRange,
  type HexRow
} from '../lib/hexRows'

/**
 * One page of a file's bytes (2026-08-31).
 *
 * The renderer never holds the file. A page is a Range request against
 * `fsmedia://`, which main answers with a 206 of exactly those bytes - the
 * same handler a playing film seeks through - so this costs 4KB whether the
 * file is a 600-byte header or a 4GB ISO. That rule is not a nicety: reading
 * a whole media file into the renderer is what once took it to 7.4GB.
 *
 * Paged rather than scrolled, deliberately. A continuous hex view of a big
 * file is a 268-million-row virtualized list with its own selection and copy
 * semantics, which is a viewer, not a panel.
 */
export function HexView({
  path,
  size,
  onClose
}: {
  path: string
  size: number
  onClose: () => void
}): JSX.Element {
  const [page, setPage] = useState(0)
  // Keyed by what was asked for rather than cleared on the way in: a result
  // for the previous page is simply not this page's, so there is nothing to
  // reset and no frame showing the wrong bytes under the right heading.
  const [got, setGot] = useState<{ key: string; rows: HexRow[] | 'failed' } | null>(null)
  const pages = pageCount(size)
  const at = clampPage(page, size)
  const key = `${path}:${at}`
  const rows = got?.key === key ? got.rows : null

  useEffect(() => {
    let alive = true
    void fetch(window.prism.mediaUrl(path), { headers: { Range: pageRange(at, size) } })
      .then((r) => r.arrayBuffer())
      .then(
        (buf) =>
          alive &&
          setGot({ key: `${path}:${at}`, rows: hexRows(new Uint8Array(buf), at * PAGE_BYTES) })
      )
      .catch(() => alive && setGot({ key: `${path}:${at}`, rows: 'failed' }))
    return () => {
      alive = false
    }
  }, [path, at, size])

  const step = (d: number): void => setPage((p) => clampPage(p + d, size))

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[color:var(--p-divider)] px-3 py-2 text-[12px] text-[var(--p-dim)]">
        <button
          className="rounded px-2 py-1 hover:bg-[var(--p-hover)] hover:text-[var(--p-text)] disabled:opacity-40"
          disabled={page <= 0}
          onClick={() => step(-1)}
        >
          Previous
        </button>
        <span className="tabular-nums">
          Page {at + 1} of {pages}
        </span>
        <button
          className="rounded px-2 py-1 hover:bg-[var(--p-hover)] hover:text-[var(--p-text)] disabled:opacity-40"
          disabled={page >= pages - 1}
          onClick={() => step(1)}
        >
          Next
        </button>
        <span className="ml-auto">
          <button
            className="rounded px-2 py-1 hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]"
            onClick={onClose}
          >
            Close
          </button>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[12px] leading-[1.55] tabular-nums">
        {rows === 'failed' && (
          <div className="text-[var(--p-dim)]">Those bytes could not be read.</div>
        )}
        {rows === null && <div className="text-[var(--p-dim)]">Reading…</div>}
        {rows !== null && rows !== 'failed' && rows.length === 0 && (
          <div className="text-[var(--p-dim)]">This file is empty.</div>
        )}
        {(rows === null || rows === 'failed' ? [] : rows).map((r) => (
          <div key={r.offset} className="flex gap-4 whitespace-pre">
            <span className="text-[var(--p-dim2)]">{offsetLabel(r.offset, size)}</span>
            <span className="text-[var(--p-text-soft)]">
              {/* A gap after the eighth byte, which is how every dump since
                  hexdump has split the row and is what makes it countable. */}
              {r.cells.slice(0, 8).join(' ')} {r.cells.slice(8).join(' ')}
            </span>
            <span className="text-[var(--p-accent-hi)]">{r.ascii}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
