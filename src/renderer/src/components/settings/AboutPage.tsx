import { useEffect, useState, type JSX } from 'react'
import { ROW_BUTTON } from 'prism-term-core/renderer/settings/fields'
import { SettingBlock } from 'prism-term-core/renderer/settings/layout/SettingBlock'
import { SettingRow } from 'prism-term-core/renderer/settings/layout/SettingRow'
import { SettingsSection } from 'prism-term-core/renderer/settings/layout/SettingsSection'
import appIcon from '../../assets/icon.png'
import { appOpt } from './appOptions'
import { iconPath } from './icons'

const DISPLAY_FONT = '"Segoe UI Variable Display", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif'

/** ABOUT: the app's own icon and one line, the version it runs (new with the
 *  grouped cards, 2026-10-05), and the first run guide again. */
export function AboutPage({ onShowSetup }: { onShowSetup: () => void }): JSX.Element {
  const [version, setVersion] = useState('')
  useEffect(() => {
    let live = true
    void window.prism.appVersion().then((v) => {
      if (live) setVersion(v)
    })
    return () => {
      live = false
    }
  }, [])
  const ver = appOpt('app-version')
  const setup = appOpt('show-setup')
  return (
    <SettingsSection id="about">
      <SettingBlock>
        <div className="flex items-center gap-[18px] px-[18px] py-5">
          <img src={appIcon} alt="" width={56} height={56} className="block h-14 w-14 shrink-0" />
          <div>
            <h4 className="m-0 text-[18px] font-bold tracking-[-0.01em] text-[var(--p-text)]" style={{ fontFamily: DISPLAY_FONT }}>
              Prism
            </h4>
            <p className="mb-0 mt-1 text-[12.5px] leading-normal text-[var(--p-dim)]">
              A quick viewer for images, video, audio and documents.
            </p>
          </div>
        </div>
      </SettingBlock>
      <SettingRow id="app-version" icon={iconPath(ver.icon)} label={ver.label} sub={ver.sub}>
        <span
          id="app-version"
          data-app-version
          className="whitespace-nowrap rounded-full border border-[color:var(--p-line)] px-2 py-0.5 font-mono text-[11px] tabular-nums text-[var(--p-text-soft)]"
        >
          {version}
        </span>
      </SettingRow>
      <SettingRow id="show-setup" icon={iconPath(setup.icon)} label={setup.label} sub={setup.sub}>
        <button id="show-setup" onClick={onShowSetup} className={ROW_BUTTON}>
          Show setup again
        </button>
      </SettingRow>
    </SettingsSection>
  )
}
