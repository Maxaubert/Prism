import { useEffect, useLayoutEffect, useRef, type JSX } from 'react'
import { busyLabel, busyPct, noteBar, stopHold, useBusyBar } from '../../lib/holds'
import { dialogButton } from '../dialogLook'

/**
 * THE LOADING BAR (owner, 2026-11-09). A job over a second covers that tab's
 * file list with this: what is happening and how far, and Cancel. The panel
 * is inside the list's own area, a sibling of the inert list frame, so it
 * covers the list and nothing else (places, preview, tab strip and the other
 * tabs stay yours), and every press and wheel over it stops here.
 *
 * The keyboard: the panel takes the focus when the list's goes (never from
 * a field or another window), and only Escape acts on it. Enter does not:
 * "Delete, Enter" is a held-down habit, and Enter on a focused Cancel would
 * throw the job away the instant the bar appears. Tab reaches Cancel itself.
 * `useListKeyboard` puts the focus back on the list when the bar goes.
 */
export function BusyBar({ directory }: { directory: string }): JSX.Element | null {
  const hold = useBusyBar(directory)
  const root = useRef<HTMLDivElement>(null)
  const id = hold?.id
  useLayoutEffect(() => {
    if (!id) return
    const at = document.activeElement
    if (!at || at === document.body || at.closest('.browse-list-area')) {
      root.current?.focus({ preventScroll: true })
    }
  }, [id])
  useEffect(() => {
    if (!id) return
    noteBar(id, true)
    return () => noteBar(id, false)
  }, [id])
  if (!hold) return null
  const pct = busyPct(hold)
  const cancel = hold.settling ? null : hold.cancel
  return (
    <div
      className="browse-busy"
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <div
        ref={root}
        className="browse-busy-panel"
        data-busy-bar={hold.verb}
        data-owns-escape
        role="status"
        aria-live="polite"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            if (cancel) stopHold(hold.id)
          }
        }}
      >
        <div className="browse-busy-main">
          <div className="browse-busy-line">
            <span className="browse-busy-label" data-busy-label>
              {busyLabel(hold)}
            </span>
            {pct !== null && <span className="browse-busy-pct">{Math.round(pct)}%</span>}
          </div>
          <div className="browse-busy-track" data-indeterminate={pct === null || undefined}>
            <span
              className="browse-busy-fill"
              style={pct === null ? undefined : { width: `${pct}%` }}
            />
          </div>
        </div>
        <button
          type="button"
          data-busy-cancel
          disabled={!cancel || hold.stopping}
          onClick={() => stopHold(hold.id)}
          className={`browse-busy-cancel ${dialogButton({})}`}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
