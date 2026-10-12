import { useEffect, useRef, useState, type JSX } from 'react'
import { shortHash } from '../../lib/propsFormat'
import { CopyButton, FactRow } from './parts'

type State =
  | { at: 'idle' }
  | { at: 'reading'; done: number; total: number }
  | { at: 'done'; hex: string }
  | { at: 'failed' }

/**
 * THE CHECKSUM ROW (owner, 2026-10-12, checksum option A: "a row that fills
 * in"). On every file: Compute, then a thin bar with a percentage and Stop
 * while main streams the file (a 35 GB film takes a while, and nothing
 * freezes), then the SHA-256 shortened in the middle with a copy button.
 * Closing the window stops a read still running.
 */
export function ChecksumRow({ path }: { path: string }): JSX.Element {
  const [state, setState] = useState<State>({ at: 'idle' })
  const running = useRef<{ cancel: () => void } | null>(null)

  useEffect(
    () => () => {
      running.current?.cancel()
      running.current = null
    },
    [path]
  )

  const start = (): void => {
    setState({ at: 'reading', done: 0, total: 0 })
    const job = window.prism.hashFile(path, (done, total) => {
      if (running.current === job) setState({ at: 'reading', done, total })
    })
    running.current = job
    void job.done.then((hex) => {
      if (running.current !== job) return // stopped, or the window moved on
      running.current = null
      setState(hex ? { at: 'done', hex } : { at: 'failed' })
    })
  }

  const stop = (): void => {
    running.current?.cancel()
    running.current = null
    setState({ at: 'idle' })
  }

  const pct = state.at === 'reading' && state.total > 0 ? Math.min(100, Math.floor((state.done / state.total) * 100)) : 0

  return (
    <FactRow label="SHA-256">
      <div data-props-checksum={state.at} className="flex min-h-[22px] items-center gap-2.5">
        {state.at === 'idle' || state.at === 'failed' ? (
          <>
            <button
              type="button"
              onClick={start}
              className="rounded-lg border border-[color:var(--p-divider)] bg-[var(--p-hover)] px-2.5 py-1 text-[12.5px] font-semibold leading-none text-[var(--p-text-soft)] transition-colors hover:text-[var(--p-text)] focus-visible:text-[var(--p-text)] focus-visible:outline-none"
            >
              Compute
            </button>
            {state.at === 'failed' && <span className="text-[var(--p-dim)]">Could not read the file</span>}
          </>
        ) : state.at === 'reading' ? (
          <>
            <div
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1.5 flex-1 overflow-hidden rounded bg-[var(--p-control)] shadow-[inset_0_0_0_1px_var(--p-line)]"
            >
              <i className="block h-full bg-[var(--p-accent)] transition-[width] duration-100" style={{ width: `${pct}%` }} />
            </div>
            <span className="w-9 text-right tabular-nums text-[var(--p-dim)]">{pct}%</span>
            <button
              type="button"
              onClick={stop}
              className="font-semibold text-[var(--p-accent)] hover:brightness-110 focus-visible:outline-none"
            >
              Stop
            </button>
          </>
        ) : (
          <>
            <span
              title={state.hex}
              data-props-hash={state.hex}
              className="select-text font-['Cascadia_Mono','Cascadia_Code',Consolas,monospace] text-[11.5px] tracking-[-.01em]"
            >
              {shortHash(state.hex)}
            </span>
            <CopyButton text={state.hex} label="Copy the SHA-256" />
          </>
        )}
      </div>
    </FactRow>
  )
}
