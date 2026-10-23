import { useEffect, useState, type JSX } from 'react'
import { termApi } from '../../host'
import { savedShellId, saveShellId } from '../../lib/termPrefs'
import { Select } from '../fields'
import { SettingRow } from '../layout/SettingRow'
import { SettingsSection } from '../layout/SettingsSection'
import { opt, sectionTitle } from './opts'

/** Which shell new terminals launch, from the ones main detected. */
export function ShellSection(): JSX.Element | null {
  // Fetched when the section first shows. A saved id may name a shell that no
  // longer exists; the select then shows the real default, which is also what
  // a new terminal would actually launch. Nothing is drawn until main has
  // listed them (Find a setting waits for the row).
  const [shells, setShells] = useState<Array<{ id: string; name: string }>>([])
  const [choice, setChoice] = useState(() => savedShellId() ?? '')
  useEffect(() => {
    let live = true
    void termApi()
      .termShells()
      .then((list) => {
        if (live) setShells(list.map((s) => ({ id: s.id, name: s.name })))
      })
    return () => {
      live = false
    }
  }, [])
  if (!shells.length) return null
  const value = shells.some((s) => s.id === choice) ? choice : (shells[0]?.id ?? '')
  const o = opt('term-shell')
  return (
    <SettingsSection id="shell" title={sectionTitle('shell')}>
      <SettingRow id="term-shell" icon={o.icon} label={o.label} sub={o.sub}>
        <Select
          id="term-shell"
          value={value}
          onChange={(v) => {
            setChoice(v)
            saveShellId(v)
          }}
          options={shells}
        />
      </SettingRow>
    </SettingsSection>
  )
}
