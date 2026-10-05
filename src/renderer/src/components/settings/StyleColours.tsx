import type { JSX } from 'react'
import { ColourField } from 'prism-term-core/renderer/settings/ColourPicker'
import { RESET_LINK } from 'prism-term-core/renderer/settings/fields'
import { SettingRow } from 'prism-term-core/renderer/settings/layout/SettingRow'
import { SettingsSection } from 'prism-term-core/renderer/settings/layout/SettingsSection'
import { withAlpha } from 'prism-term-core/renderer/lib/colour'
import { ALPHA_MIN, accentAlphaOf } from '../../lib/accentAlpha'
import {
  folderIconOf,
  paletteOf,
  primaryValue,
  PRIMARY_ALPHA_MIN,
  resetAccent,
  restoreOverrides,
  secondaryValue,
  selectionValue,
  setAccentColour,
  setAcrylic,
  setOverride,
  setPrimary,
  setSecondary,
  setSelection,
  snapPrimaryAlpha,
  TINT_MIN,
  useOverrides,
  useStyle
} from '../../lib/theme'
import { appOpt } from './appOptions'
import { iconPath } from './icons'
import { coloursTitle } from './settingsIndex'

/**
 * One colour of the style, as a row: the core's picker (ONE COLOUR PICKER,
 * owner 2026-10-03: "the colour pickers should be the same for both apps, i
 * need an input field for a color code and an alpha per colour on every
 * colour setting"), with a Reset word beside it while the colour is the
 * user's. The code field commits only a typed colour that differs from the one
 * shown, so tabbing through a row writes nothing; Escape in the picker puts
 * the row back as it was when it opened (`onRevert`), an unset row included.
 */
function StyleColour({
  id,
  value,
  custom,
  onChange,
  onReset,
  onRevert,
  alphaMin,
  snapAlpha
}: {
  id: string
  value: string
  custom: boolean
  onChange: (stored: string) => void
  onReset: () => void
  onRevert: () => void
  alphaMin?: number
  snapAlpha?: (a: number) => number
}): JSX.Element {
  const o = appOpt(id)
  return (
    <SettingRow id={id} icon={iconPath(o.icon)} label={o.label} sub={o.sub}>
      <div className="flex items-center gap-2.5" data-colour-row={id}>
        {custom && (
          <button onClick={onReset} className={RESET_LINK}>
            Reset
          </button>
        )}
        <ColourField
          id={id}
          label={o.label}
          value={value}
          onChange={onChange}
          onRevert={onRevert}
          alphaMin={alphaMin}
          snapAlpha={snapAlpha}
        />
      </div>
    </SettingRow>
  )
}

/**
 * THE STYLE'S COLOURS, BY IMPORTANCE (owner, 2026-10-03: "make the most
 * important colours appear first ... primary and secondary first then
 * accent"): the viewer's ground, the panels round it, the accent, the
 * selection that came out of it, the text, the folder icons. Headed by the
 * style they edit ("Colours of Aurora"), since every edit here is an edit of
 * that style until it is saved as a preset.
 */
export function StyleColoursSection(): JSX.Element {
  const style = useStyle()
  const edits = useOverrides()
  const accentAlpha = accentAlphaOf(style.accentAlpha)
  // What a picker's Escape puts back: the draft as it is at this render, which
  // is the one a popover opening now captures.
  const putBack = (keys: Array<keyof typeof edits>) => () => restoreOverrides(edits, keys)
  return (
    <SettingsSection id="style-colours" title={coloursTitle(style.name)}>
      {/* PRIMARY'S ALPHA IS THE OLD ACRYLIC SLIDER (owner, 2026-10-03,
          decision 1): below 100 the window is glass at the level that alpha
          paints (a mica style stays mica), at 100 it is solid. A hue edit
          never touches the glass. */}
      <StyleColour
        id="c-bg"
        value={primaryValue(style)}
        custom={!!edits.bg || edits.acrylic !== undefined}
        onChange={setPrimary}
        onReset={() => {
          setOverride('bg', null)
          setAcrylic(null)
        }}
        onRevert={putBack(['bg', 'acrylic'])}
        alphaMin={PRIMARY_ALPHA_MIN}
        snapAlpha={snapPrimaryAlpha}
      />
      {/* ONE PICK for the sidebar, the title bar and the tab bar (owner,
          2026-09-03). Its alpha follows Primary's until it is moved, and is
          its own after (owner, 2026-10-03, decision 2). */}
      <StyleColour
        id="c-chrome"
        value={secondaryValue(style)}
        custom={!!edits.side}
        onChange={setSecondary}
        onReset={() => setOverride('chrome', null)}
        onRevert={putBack(['side', 'title', 'tabs'])}
      />
      {/* The accent is a colour you choose, not a scheme you browse; its
          alpha is for fills (#249), so an alpha of its own is an edit of the
          accent too, and the one Reset gives back both. */}
      <StyleColour
        id="c-accent"
        value={withAlpha(paletteOf(style.accent)[0], accentAlpha)}
        custom={!!edits.accent || edits.accentAlpha !== undefined}
        onChange={setAccentColour}
        onReset={resetAccent}
        onRevert={putBack(['accent', 'accentAlpha'])}
        alphaMin={ALPHA_MIN}
      />
      {/* THE SELECTION IS ITS OWN ROW (#257): its colour and alpha ARE the
          tint of marked files and the current place. Unset it shows the
          accent's tint, and nothing is stored until a pick; below a tenth a
          mark stops reading as one, hence the floor. */}
      <StyleColour
        id="c-selection"
        value={selectionValue(style)}
        custom={!!edits.selection}
        onChange={setSelection}
        onReset={() => setOverride('selection', null)}
        onRevert={putBack(['selection'])}
        alphaMin={TINT_MIN}
      />
      <StyleColour
        id="c-text"
        value={style.text}
        custom={!!edits.text}
        onChange={(v) => setOverride('text', v)}
        onReset={() => setOverride('text', null)}
        onRevert={putBack(['text'])}
      />
      <StyleColour
        id="c-folder-icon"
        value={style.folderIcon ?? folderIconOf(style)}
        custom={!!edits.folderIcon}
        onChange={(v) => setOverride('folderIcon', v)}
        onReset={() => setOverride('folderIcon', null)}
        onRevert={putBack(['folderIcon'])}
      />
    </SettingsSection>
  )
}
