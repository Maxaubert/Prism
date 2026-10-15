import type { FolderHandlerStatus } from '@shared/folderHandler'
import { useEffect, useRef, useState, type JSX } from 'react'
import { Switch } from 'prism-term-core/renderer/settings/fields'
import { SettingRow } from 'prism-term-core/renderer/settings/layout/SettingRow'
import { appOpt } from './appOptions'
import { iconPath } from '../icons/settingsIcons'

/**
 * OPEN FOLDERS FROM OTHER APPS (#393; owner, 2026-10-15), off by default.
 * Windows owns the answer, so the switch shows only what Windows reports, and
 * what it says beyond on and off is the row's subtext, as on the Win+E row.
 */
export function FolderHandlerRow(): JSX.Element {
  const [status, setStatus] = useState<FolderHandlerStatus>({ available: false, on: false, mine: false })
  const [busy, setBusy] = useState(true)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    void window.prism
      .folderHandlerStatus()
      .then((value) => {
        if (mounted.current) setStatus(value)
      })
      .catch(() => {
        if (mounted.current) setStatus((value) => ({ ...value, error: 'Could not check with Windows.' }))
      })
      .finally(() => {
        if (mounted.current) setBusy(false)
      })
    return () => {
      mounted.current = false
    }
  }, [])

  // One press, one change (the label names the switch too).
  const pending = useRef(false)
  const toggle = (): void => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    void window.prism
      .setFolderHandler(!status.mine)
      .then((value) => {
        if (mounted.current) setStatus(value)
      })
      .catch(() => {
        if (mounted.current) setStatus((value) => ({ ...value, error: 'Could not change the setting.' }))
      })
      .finally(() => {
        pending.current = false
        if (mounted.current) setBusy(false)
      })
  }

  const said = busy
    ? 'Checking with Windows.'
    : status.error || (status.on && !status.mine ? 'Another Prism installation opens folders now.' : '')
  const o = appOpt('open-folders')
  return (
    <SettingRow id="open-folders" icon={iconPath(o.icon)} label={o.label} sub={said || o.sub} warn={!busy && !!said} tap>
      {said && (
        <span role="status" className="sr-only">
          {said}
        </span>
      )}
      <Switch on={status.mine} onChange={() => toggle()} label={o.label} disabled={busy || !status.available} />
    </SettingRow>
  )
}
