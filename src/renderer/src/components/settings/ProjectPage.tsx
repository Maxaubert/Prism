import type { JSX } from 'react'
import { Select } from 'prism-term-core/renderer/settings/fields'
import { SettingRow } from 'prism-term-core/renderer/settings/layout/SettingRow'
import { SettingsSection } from 'prism-term-core/renderer/settings/layout/SettingsSection'
import { setNewTabShow, useNewTabShow, type NewTabShow } from '../../lib/newTabPrefs'
import { APP_SECTIONS, appOpt } from './appOptions'
import { iconPath } from './icons'

// PROJECT SETTINGS (#296; owner, 2026-10-06: "project specific settings
// should be in a tab called project settings not in explorer"). The rows only
// a project tab uses: what a folder opened as a project shows first. Folder
// for new tabs stays on Explorer, since the + and Ctrl+T open an Explorer tab.
// Sidebar position left this page for Explorer's Layout (#304; owner,
// 2026-10-07): it moves the Explorer's places AND the project tree, one
// sidebar, one row.

const row = (id: string): { icon: string; label: string; sub: string } => {
  const o = appOpt(id)
  return { icon: iconPath(o.icon), label: o.label, sub: o.sub }
}

export function ProjectPage(): JSX.Element {
  const tabShow = useNewTabShow()
  return (
    <SettingsSection id="project" title={APP_SECTIONS.project}>
      <SettingRow id="newtab-show" {...row('newtab-show')}>
        <Select
          id="newtab-show"
          value={tabShow}
          onChange={(v) => setNewTabShow(v as NewTabShow)}
          options={[
            { id: 'file', name: 'First file in the folder' },
            { id: 'terminal', name: 'A terminal' },
            { id: 'none', name: 'Folder browser' }
          ]}
        />
      </SettingRow>
    </SettingsSection>
  )
}
