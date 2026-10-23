import type { JSX, ReactNode } from 'react'
import { setTermAcrylic, useTermAcrylic } from '../../lib/termLook'
import { SaveButton, Switch } from '../fields'
import { SettingBlock } from '../layout/SettingBlock'
import { SettingRow } from '../layout/SettingRow'
import { SettingsSection } from '../layout/SettingsSection'
import { ThemeWall } from '../theme/ThemeWall'
import { useTermSetup } from '../theme/useTermSetup'
import { acrylicSub, opt, saveSetupTitle, sectionTitle, themeSub } from './opts'

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
  const setup = useTermSetup()
  const dirty = setup.dirty || extraDirty
  const save = (): void => {
    setup.save()
    onSaved?.()
  }
  const theme = opt('term-theme')
  const acrylic = opt('term-acrylic')
  return (
    <SettingsSection id="theme" title={sectionTitle('theme')}>
      <SettingRow id="term-theme" icon={theme.icon} label={theme.label} sub={themeSub()}>
        <SaveButton dirty={dirty} onClick={save} title={saveSetupTitle()} />
      </SettingRow>
      <SettingBlock pad data-term-wall="">
        <ThemeWall onThemePicked={onThemePicked} extraDirty={extraDirty} onSaved={onSaved} />
      </SettingBlock>
      {/* The switch: whether the terminal lets the app style's glass show through. */}
      <SettingRow
        id="term-acrylic"
        icon={acrylic.icon}
        label={acrylic.label}
        sub={acrylicSub()}
        tap
      >
        <Switch on={acrylicOn} onChange={setTermAcrylic} label={acrylic.label} />
      </SettingRow>
      {afterTheme}
    </SettingsSection>
  )
}
