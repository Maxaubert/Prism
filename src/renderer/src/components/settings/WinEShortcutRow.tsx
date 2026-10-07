import type { WinEShortcutStatus } from '@shared/winEShortcut'
import { useEffect, useRef, useState, type JSX } from 'react'
import { Switch } from 'prism-term-core/renderer/settings/fields'
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
 * The switch is the core's, like every other (#318; owner, 2026-10-07:
 * "toggles differ in look i like the teal with black not the green and
 * white", then "it should depend on the theme"). It used to draw its own,
 * the accent with a white knob (#202's exception), the one switch in
 * Settings that did; the core's on switch now wears the style's accent with
 * the ink chosen for it, so there is nothing left to be an exception for.
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

  // ONE PRESS, ONE CHANGE: the row flips its switch on a press anywhere, and
  // its label also names this switch by id, so one press on the label can
  // reach it twice before a render disables it. A ref, read at once.
  const pending = useRef(false)
  const toggle = (): void => {
    if (pending.current) return
    pending.current = true
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
        pending.current = false
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
      <Switch
        on={status.enabled}
        onChange={() => toggle()}
        label={o.label}
        disabled={busy || !status.available || (status.conflict && !status.enabled)}
      />
    </SettingRow>
  )
}
