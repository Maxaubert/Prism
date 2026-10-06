import type { JSX } from 'react'
import { Segmented, Select } from 'prism-term-core/renderer/settings/fields'
import { SettingRow } from 'prism-term-core/renderer/settings/layout/SettingRow'
import { SettingsSection } from 'prism-term-core/renderer/settings/layout/SettingsSection'
import { setNewTabShow, useNewTabShow, type NewTabShow } from '../../lib/newTabPrefs'
import { setTreeSide, TREE_SIDES, useTreeSide, type TreeSide } from '../../lib/treePrefs'
import { APP_SECTIONS, appOpt } from './appOptions'
import { iconPath } from './icons'

// PROJECT SETTINGS (#296; owner, 2026-10-06: "project specific settings
// should be in a tab called project settings not in explorer"). The rows only
// a project tab uses: the side its file tree sits on, and what a folder
// opened as a project shows first. Folder for new tabs stays on Explorer,
// since the + and Ctrl+T open an Explorer tab.

const row = (id: string): { icon: string; label: string; sub: string } => {
  const o = appOpt(id)
  return { icon: iconPath(o.icon), label: o.label, sub: o.sub }
}

export function ProjectPage(): JSX.Element {
  const side = useTreeSide()
  const tabShow = useNewTabShow()
  return (
    <SettingsSection id="project" title={APP_SECTIONS.project}>
      <SettingRow id="tree-side" {...row('tree-side')}>
        <Segmented value={side} onChange={(v) => setTreeSide(v as TreeSide)} options={TREE_SIDES} />
      </SettingRow>
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
