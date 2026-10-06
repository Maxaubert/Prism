import { useEffect, useState, type JSX } from 'react'
import { ROW_BUTTON, Segmented, Select, Switch } from 'prism-term-core/renderer/settings/fields'
import { SettingRow } from 'prism-term-core/renderer/settings/layout/SettingRow'
import { SettingsSection } from 'prism-term-core/renderer/settings/layout/SettingsSection'
import { DRIVE_STYLES, setDriveStyle, useDriveStyle } from '../../lib/driveStylePrefs'
import { EXPLORER_SIZES, setExplorerSize, useExplorerSize } from '../../lib/explorerSize'
import { setRememberFolders, useRememberFolders } from '../../lib/listingCachePrefs'
import { setNewTabMode, useNewTabFolder, useNewTabMode } from '../../lib/newTabPrefs'
import { setOpenMode, useOpenMode, type OpenMode } from '../../lib/openPrefs'
import { setRememberTabs, useRememberTabs } from '../../lib/tabRestorePrefs'
import { setTreeSide, TREE_SIDES, useTreeSide, type TreeSide } from '../../lib/treePrefs'
import { visitedDirectories } from '../../lib/visitedDirectories'
import { APP_SECTIONS, appOpt } from './appOptions'
import { iconPath } from './icons'
import { WinEShortcutRow } from './WinEShortcutRow'

// EXPLORER (2026-10-05, the grouped cards redesign): what was General, the
// tree and the Explorer's rows, sorted by what they set up: the layout, how
// things open, what comes back at a start, and how Prism sits in Windows.
// What only a PROJECT tab uses is on Project settings (owner, 2026-10-06).

/** One of this page's rows, its icon, label and resting subtext read from
 *  `appOptions.ts` so the page and Find a setting say the same words. */
const row = (id: string): { icon: string; label: string; sub: string } => {
  const o = appOpt(id)
  return { icon: iconPath(o.icon), label: o.label, sub: o.sub }
}

function LayoutSection(): JSX.Element {
  const size = useExplorerSize()
  const drives = useDriveStyle()
  const side = useTreeSide()
  return (
    <SettingsSection id="layout" title={APP_SECTIONS.layout}>
      {/* ONE SIDEBAR, ONE ROW (#304; owner, 2026-10-07: "fix the setting in
          Explorer for the sidebar where you can put it on the right side or
          the left side"). The Explorer's places and the project tree move
          together; on the right the preview pane takes the left. */}
      <SettingRow id="tree-side" {...row('tree-side')}>
        <Segmented value={side} onChange={(v) => setTreeSide(v as TreeSide)} options={TREE_SIDES} />
      </SettingRow>
      {/* The Explorer's rows alone (owner, 2026-10-03): the tree and the rest
          of the app keep Font size. */}
      <SettingRow id="explorer-size" {...row('explorer-size')}>
        <Segmented value={size} onChange={setExplorerSize} options={EXPLORER_SIZES.map(({ id, name }) => ({ id, name }))} />
      </SettingRow>
      {/* This PC's rows in the sidebar (#296; owner, 2026-10-06: "option A,
          D and E as options in settings, with A being default"). */}
      <SettingRow id="drive-style" {...row('drive-style')}>
        <Segmented value={drives} onChange={setDriveStyle} options={DRIVE_STYLES} />
      </SettingRow>
    </SettingsSection>
  )
}

function OpeningSection(): JSX.Element {
  const tabMode = useNewTabMode()
  const tabFolder = useNewTabFolder()
  const openAs = useOpenMode()
  // Picking "A chosen folder" opens the chooser right away; cancelling keeps
  // whatever was set before rather than leaving a mode with no folder.
  const pickTabMode = (v: string): void => {
    if (v === 'folder') {
      void window.prism.pickFolder().then((dir) => {
        if (dir) setNewTabMode('folder', dir)
      })
    } else setNewTabMode(v as 'home' | 'ask')
  }
  const chosen = tabMode === 'folder' && !!tabFolder
  return (
    <SettingsSection id="opening" title={APP_SECTIONS.opening}>
      {/* The folder itself is a path, which a subtext does not hold (plain
          words only), so it rides on the control's tooltip. */}
      <SettingRow id="newtab-mode" {...row('newtab-mode')} sub={chosen ? 'Opens in the folder you chose.' : appOpt('newtab-mode').sub}>
        <div title={chosen ? tabFolder : undefined}>
          <Select
            id="newtab-mode"
            value={tabMode}
            onChange={pickTabMode}
            options={[
              { id: 'home', name: 'Your user folder' },
              { id: 'folder', name: 'A chosen folder…' },
              { id: 'ask', name: 'Always ask' }
            ]}
          />
        </div>
      </SettingRow>
      {/* Owner, 2026-09-22: a file from outside opens in the Explorer tab,
          "maximized or as previews ... default should be preview". */}
      <SettingRow id="open-external" {...row('open-external')}>
        <Segmented
          value={openAs}
          onChange={(v) => setOpenMode(v as OpenMode)}
          options={[
            { id: 'preview', name: 'Preview' },
            { id: 'full', name: 'Full view' }
          ]}
        />
      </SettingRow>
    </SettingsSection>
  )
}

/**
 * What comes back at a start. Reopen tabs (owner, 2026-09-22): off, a cold
 * start opens only the Explorer tab and what Prism was opened with. Remember
 * recent folders (#271; owner-approved, 2026-10-04: on by default, a switch
 * and a Clear button): off deletes the list at once; Clear deletes it and
 * keeps the switch as it is.
 */
function StartsSection(): JSX.Element {
  const tabsOn = useRememberTabs()
  const foldersOn = useRememberFolders()
  const [cleared, setCleared] = useState(false)
  const folders = appOpt('remember-folders')
  return (
    <SettingsSection id="starts" title={APP_SECTIONS.starts}>
      <SettingRow id="remember-tabs" {...row('remember-tabs')} tap>
        <Switch on={tabsOn} onChange={setRememberTabs} label={appOpt('remember-tabs').label} />
      </SettingRow>
      <SettingRow id="remember-folders" {...row('remember-folders')} tap>
        <button
          id="remember-folders-clear"
          className={ROW_BUTTON}
          disabled={cleared}
          onClick={() => {
            visitedDirectories.clear()
            void window.prism.clearListingCache().then(() => setCleared(true))
          }}
        >
          {cleared ? 'Cleared' : 'Clear'}
        </button>
        <Switch
          on={foldersOn}
          onChange={(next) => {
            setCleared(false)
            setRememberFolders(next)
          }}
          label={folders.label}
        />
      </SettingRow>
    </SettingsSection>
  )
}

/** How Prism sits in Windows: Win+E, the Explorer menu, the default apps.
 *  Windows owns all three, so each reports what Windows says. */
function WindowsSection(): JSX.Element {
  // Explorer's context-menu verb lives in the registry, not in settings.json:
  // the switch reports what Windows actually has.
  const [verb, setVerbState] = useState(false)
  const [verbBusy, setVerbBusy] = useState(true)
  useEffect(() => {
    let live = true
    void window.prism.shellVerbStatus().then((on) => {
      if (live) {
        setVerbState(on)
        setVerbBusy(false)
      }
    })
    return () => {
      live = false
    }
  }, [])
  const setVerb = (on: boolean): void => {
    setVerbBusy(true)
    void window.prism.setShellVerb(on).then(async () => {
      // Read it back rather than trusting the write: this is the registry.
      setVerbState(await window.prism.shellVerbStatus())
      setVerbBusy(false)
    })
  }
  const menu = appOpt('explorer-verb')
  return (
    <SettingsSection id="windows" title={APP_SECTIONS.windows}>
      <WinEShortcutRow />
      <SettingRow id="explorer-verb" {...row('explorer-verb')} sub={verbBusy ? 'Checking with Windows.' : menu.sub} tap>
        <Switch on={verb} onChange={setVerb} label={menu.label} disabled={verbBusy} />
      </SettingRow>
      {/* Setup offers this once; this is where you find it afterwards. Windows
          owns the choice, so all we can do is open the page it lives on. */}
      <SettingRow id="default-apps" {...row('default-apps')}>
        <button id="default-apps" onClick={() => void window.prism.openDefaultApps()} className={ROW_BUTTON}>
          Choose in Windows
        </button>
      </SettingRow>
    </SettingsSection>
  )
}

export function ExplorerPage(): JSX.Element {
  return (
    <>
      <LayoutSection />
      <OpeningSection />
      <StartsSection />
      <WindowsSection />
    </>
  )
}
