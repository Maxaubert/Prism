import type { JSX } from 'react'
import { FONT_PCTS, TERM_FONTS, setTermFontId, setTermFontPct, useTermFontId, useTermFontPct } from '../../lib/termLook'
import { Select } from '../fields'
import { SettingRow } from '../layout/SettingRow'
import { SettingsSection } from '../layout/SettingsSection'
import { opt, sectionTitle } from './opts'

/** The terminal's typeface and its size. Neither belongs to a theme
 *  (2026-09-28): a theme switch and Save changes leave both alone, which is
 *  why they can live apart from the theme wall. */
export function TerminalTextSection(): JSX.Element {
  const fontPct = useTermFontPct()
  const fontId = useTermFontId()
  const family = opt('term-font-family')
  const size = opt('term-font')
  return (
    <SettingsSection id="text" title={sectionTitle('text')}>
      <SettingRow id="term-font-family" icon={family.icon} label={family.label} sub={family.sub}>
        <Select
          id="term-font-family"
          value={fontId}
          onChange={setTermFontId}
          options={TERM_FONTS.map((f) => ({ id: f.id, name: f.name, style: { fontFamily: f.stack } }))}
        />
      </SettingRow>
      <SettingRow id="term-font" icon={size.icon} label={size.label} sub={size.sub}>
        <Select
          id="term-font"
          value={String(fontPct)}
          onChange={(v) => setTermFontPct(Number(v))}
          options={FONT_PCTS.map((p) => ({ id: String(p), name: `${p}%` }))}
        />
      </SettingRow>
    </SettingsSection>
  )
}
