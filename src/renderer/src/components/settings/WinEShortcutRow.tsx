import type { WinEShortcutStatus } from '@shared/winEShortcut'
import { useEffect, useRef, useState, type JSX } from 'react'
import { SettingRow } from 'prism-term-core/renderer/settings/layout/SettingRow'
import { appOpt } from './appOptions'
import { iconPath } from './icons'

/**
 * OPEN IN PLACE OF FILE EXPLORER (Win+E), as a row. Windows owns this
 * preference; never show an optimistic or locally cached value. What Windows
 * says about it is the row's SUBTEXT (2026-10-05, the grouped cards redesign:
 * live state lives in the subtext, so a sighted user and a screen reader get
 * the same words), and a live region carries it only while there is one.
 *
 * The switch keeps the ACCENT when on, the one switch in Settings that does
 * (#202's existing exception): it hands a Windows shortcut to Prism.
 */
export function WinEShortcutRow(): JSX.Element {
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
            error: 'Could not check the Windows shortcut.'
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
            error: 'Could not change the Windows shortcut.'
          }))
      })
      .finally(() => {
        if (mounted.current) setBusy(false)
      })
  }

  const said = busy
    ? 'Checking with Windows.'
    : status.error ||
      (status.conflict
        ? 'Another Prism installation or profile controls this shortcut.'
        : status.enabled && !status.running
          ? 'The shortcut helper is not running.'
          : '')
  const o = appOpt('win-e-shortcut')
  return (
    <SettingRow
      id="win-e-shortcut"
      icon={iconPath(o.icon)}
      label={o.label}
      sub={said || o.sub}
      warn={!busy && !!said}
      tap
    >
      {said && (
        <span role="status" className="sr-only">
          {said}
        </span>
      )}
      <button
        id="win-e-shortcut"
        role="switch"
        aria-label={o.label}
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
    </SettingRow>
  )
}
