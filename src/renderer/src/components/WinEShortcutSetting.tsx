import type { WinEShortcutStatus } from '@shared/winEShortcut'
import { useEffect, useRef, useState, type JSX } from 'react'

/** Windows owns this preference; never show an optimistic or locally cached value. */
export function WinEShortcutSetting(): JSX.Element {
  const [status, setStatus] = useState<WinEShortcutStatus>({
    enabled: false,
    running: false,
    conflict: false,
    available: false
  })
  const [busy, setBusy] = useState(true)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    void window.prism
      .winEShortcutStatus()
      .then((value) => {
        if (mounted.current) setStatus({ ...value, error: value.error ?? '' })
      })
      .catch(() => {
        if (mounted.current)
          setStatus((value) => ({
            ...value,
            error: 'Could not check the Windows shortcut. Try opening Settings again.'
          }))
      })
      .finally(() => {
        if (mounted.current) setBusy(false)
      })
    return () => {
      mounted.current = false
    }
  }, [])

  const toggle = (): void => {
    setBusy(true)
    void window.prism
      .setWinEShortcut(!status.enabled)
      .then((value) => {
        if (mounted.current) setStatus({ ...value, error: value.error ?? '' })
      })
      .catch(() => {
        if (mounted.current)
          setStatus((value) => ({
            ...value,
            error: 'Could not change the Windows shortcut. Try again.'
          }))
      })
      .finally(() => {
        if (mounted.current) setBusy(false)
      })
  }

  return (
    <div className="flex items-center justify-between gap-8 border-b border-[color:var(--p-line)] py-2.5">
      <div className="min-w-0">
        <label
          htmlFor="win-e-shortcut"
          className="block text-[12.5px] font-semibold text-[var(--p-text)]"
        >
          Open Prism with Win+E
        </label>
        <p id="win-e-shortcut-hint" className="mt-0.5 text-[11.5px] text-[var(--p-dim)]">
          Starts a small helper at sign-in. Windows File Explorer takes over if Prism is
          unavailable.
        </p>
        <p role="status" className="mt-0.5 text-[11.5px] text-[var(--p-dim)]">
          {busy
            ? 'Checking Windows…'
            : status.error ||
              (status.conflict
                ? 'Another Prism installation or profile controls Win+E.'
                : status.enabled && !status.running
                  ? 'The shortcut helper is not running.'
                  : '')}
        </p>
      </div>
      <button
        id="win-e-shortcut"
        role="switch"
        aria-label="Open Prism with Win+E"
        aria-describedby="win-e-shortcut-hint"
        aria-checked={status.enabled}
        disabled={busy || !status.available || (status.conflict && !status.enabled)}
        onClick={toggle}
        className={`relative h-[20px] w-[36px] shrink-0 rounded-full transition-colors disabled:opacity-50 ${status.enabled ? 'bg-[var(--p-accent)]' : 'bg-[var(--p-track)]'}`}
      >
        <span
          className="absolute left-[2px] top-[2px] h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-150 ease-out"
          style={{ transform: status.enabled ? 'translateX(16px)' : 'none' }}
        />
      </button>
    </div>
  )
}
