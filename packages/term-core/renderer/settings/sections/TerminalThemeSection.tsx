import type { JSX, ReactNode } from 'react'
import { hostOwnsWindowAcrylic } from '../../host'
import {
  SEE_THROUGH_TOP,
  setTermAcrylic,
  setTermSeeThrough,
  useTermAcrylic,
  useTermSeeThrough
} from '../../lib/termLook'
import { SaveButton, Slider, Switch } from '../fields'
import { SettingBlock } from '../layout/SettingBlock'
import { SettingRow } from '../layout/SettingRow'
import { SettingsSection } from '../layout/SettingsSection'
import { ThemeWall } from '../theme/ThemeWall'
import { useNoAcrylic, useTermSetup } from '../theme/useTermSetup'
import { acrylicLabel, acrylicSub, opt, saveSetupTitle, sectionTitle, themeSub } from './opts'

/**
 * THE THEME, as one section (2026-10-05): the theme row with Save changes, the
 * wall of cards, acrylic, and the host's own rows that a theme sets (Prism
 * Terminal: Background and Accent). Under the wall only what a theme DOES set
 * (2026-09-28); the font and the indicator live in their own sections.
 * Acrylic comes FIRST under the wall (#156), as Prism's "See-through window"
 * does: see-through first, then the theme's colours.
 */
export function TerminalThemeSection({
  afterTheme,
  onThemePicked,
  extraDirty = false,
  onSaved
}: {
  /** The host's own rows that a theme sets, under the wall and acrylic. */
  afterTheme?: ReactNode
  /** A card was picked (Custom included, `id` says which; the editor's save
   *  says `edited`), after the pick landed. */
  onThemePicked?: (id: string) => void
  /** The host's own unsaved changes (its window colours): they light Save
   *  changes too, and a save tells the host (`onSaved`) to keep them. */
  extraDirty?: boolean
  onSaved?: () => void
} = {}): JSX.Element {
  const acrylicOn = useTermAcrylic()
  const level = useTermSeeThrough()
  const windowGlass = hostOwnsWindowAcrylic()
  const setup = useTermSetup()
  const dirty = setup.dirty || extraDirty
  const save = (): void => {
    setup.save()
    onSaved?.()
  }
  const noAcrylic = useNoAcrylic()
  const theme = opt('term-theme')
  const acrylic = opt('term-acrylic')
  const label = acrylicLabel()
  return (
    <SettingsSection id="theme" title={sectionTitle('theme')}>
      <SettingRow id="term-theme" icon={theme.icon} label={theme.label} sub={themeSub()}>
        <SaveButton dirty={dirty} onClick={save} title={saveSetupTitle()} />
      </SettingRow>
      <SettingBlock pad data-term-wall="">
        <ThemeWall onThemePicked={onThemePicked} extraDirty={extraDirty} onSaved={onSaved} />
      </SettingBlock>
      {/* The material does not exist before Windows 11, so there the row says
          why instead of offering a control that would do nothing. Where the
          terminal owns the window acrylic it is the see-through SLIDER
          (owner, 2026-10-13), 0 being off; in Prism the switch it was. */}
      <SettingRow
        id="term-acrylic"
        icon={acrylic.icon}
        label={label}
        sub={noAcrylic ? 'Needs Windows 11.' : acrylicSub()}
        off={noAcrylic}
        tap={!windowGlass}
      >
        {windowGlass ? (
          <Slider
            value={noAcrylic ? 0 : level}
            max={SEE_THROUGH_TOP}
            onChange={setTermSeeThrough}
            label={label}
            format={(v) => (v === 0 ? 'Off' : `${v}%`)}
            disabled={noAcrylic}
          />
        ) : (
          <Switch on={acrylicOn && !noAcrylic} onChange={setTermAcrylic} label={label} disabled={noAcrylic} />
        )}
      </SettingRow>
      {afterTheme}
    </SettingsSection>
  )
}
