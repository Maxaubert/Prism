import type { CSSProperties, JSX } from 'react'
import { SaveButton, Segmented, Select, Switch } from 'prism-term-core/renderer/settings/fields'
import { SettingRow, SUB_INK } from 'prism-term-core/renderer/settings/layout/SettingRow'
import { SettingsSection } from 'prism-term-core/renderer/settings/layout/SettingsSection'
import { setTabWidth, useTabWidth } from '../../lib/tabWidthPrefs'
import { setTitleBarMode, useTitleBarMode } from '../../lib/titleBarPrefs'
import { setTreeSize, TREE_SIZES, useTreeSize, type TreeSize } from '../../lib/treePrefs'
import {
  FONTS,
  isEdited,
  paintedAlpha,
  savePreset,
  setAcrylic,
  setOverride,
  useCurrentId,
  useOverrides,
  useRetired,
  useStoredStyle,
  useStyle,
  useThemes,
  type FontId,
  type Style
} from '../../lib/theme'
import { APP_SECTIONS, appOpt } from './appOptions'
import { iconPath } from './icons'
import { StyleColoursSection } from './StyleColours'
import { ThemeWall } from './ThemeWall'

// APPEARANCE (2026-10-05, the grouped cards redesign; it was Style; #298 the
// themes): the Themes card and its wall, This theme (see-through, Save), the
// theme's colours, the text, and the window. Rows marked as the theme's
// (colours, Font, Panel edges, Corner roundness, See-through) are edits of the
// chosen theme and light Save changes; the rest are this app's own and a
// theme switch leaves them alone. THERE IS NO COLOUR MODE (owner, 2026-10-06:
// one picker, no light/dark switch): each theme is dark or light by itself.
//
// THE FILE ICONS SWITCH IS GONE FROM HERE (owner, 2026-09-01: "hide that color
// setting for now ... we might come back to it"), and theme.ts forces the
// scheme to monochrome. Everything behind it is intact (IconScheme,
// iconSchemeOf, the iconScheme override, ICON_COLOURS, ICON_FULL_COLOUR), so
// bringing it back is a row with a Segmented of Monochrome / Coloured wired to
// setOverride('iconScheme'), plus flipping ICON_SCHEME_SHOWN.

// Each option set in its own face, so the picker previews what it names.
const FONT_OPTIONS: Array<{ id: FontId; name: string; style: CSSProperties }> = (Object.keys(FONTS) as FontId[]).map((id) => ({
  id,
  name: FONTS[id].name,
  style: { fontFamily: FONTS[id].stack }
}))

// Weakest to strongest, a scale read in order.
const EDGE_OPTIONS: Array<{ id: Style['borders']; name: string }> = [
  { id: 'none', name: 'None' },
  { id: 'faint', name: 'Faint' },
  { id: 'hairline', name: 'Hairline' },
  { id: 'strong', name: 'Strong' }
]

const CORNER_OPTIONS: Array<{ id: Style['corners']; name: string }> = [
  { id: '2', name: 'Square' },
  { id: '8', name: 'Soft' },
  { id: '14', name: 'Round' }
]

// Dynamic first: it is the default (owner, 2026-09-23: "call it dynamic ...
// have dynamic be the default").
const TAB_WIDTH_OPTIONS: Array<{ id: 'dynamic' | 'fixed'; name: string }> = [
  { id: 'dynamic', name: 'Dynamic' },
  { id: 'fixed', name: 'Fixed' }
]

/**
 * THE THEMES CARD (#298; owner, 2026-10-06): its first row is the header,
 * "Themes" / "Choose your look." with no control, and the wall under it.
 * A theme the migration retired puts ONE quiet line under the header until
 * the next pick.
 */
function ThemesSection(): JSX.Element {
  const theme = appOpt('style-theme')
  const retired = useRetired()
  const stored = useStoredStyle()
  return (
    <SettingsSection id="style-theme" title={APP_SECTIONS['style-theme']}>
      <SettingRow id="style-theme" icon={iconPath(theme.icon)} label={theme.label} sub={theme.sub}>
        {null}
      </SettingRow>
      {retired && (
        <p data-theme-retired="" className={`-mt-1 mb-1 pl-[60px] pr-4 text-[11.5px] ${SUB_INK}`}>
          Your theme {retired} was retired, {stored.name} is the closest.
        </p>
      )}
      <div data-style-wall="" className="relative pb-2 pl-1 pr-1.5">
        <ThemeWall label={theme.label} />
      </div>
    </SettingsSection>
  )
}

/** The see-through level a SOLID theme is given when the switch turns it on:
 *  the alpha Glacier (dark) and Orchid (light) paint. */
const SEE_THROUGH_LEVEL: Record<Style['mode'], number> = { dark: 70, light: 49 }

/**
 * THIS THEME (#298): whether the desktop shows through, and Save changes.
 * The switch is the SAME draft value as Primary's alpha in Colours below, so
 * the two always agree. Not on the high contrast themes: their contrast is
 * measured on a solid ground, and glass would put an unmeasurable desktop
 * under the text.
 */
function ThisThemeSection(): JSX.Element {
  const shown = useStoredStyle()
  const current = useCurrentId()
  const base = useThemes().find((t) => t.id === current)
  const edits = useOverrides()
  // Ask the store rather than re-deriving it here: a Save button that misses
  // an edit loses it.
  const dirty = isEdited()
  void edits // re-render when an edit lands, so `dirty` is read again
  const glass = appOpt('see-through')
  const save = appOpt('theme-edits')
  const on = paintedAlpha(shown) < 1
  const baseGlassy = !!base && (base.material === 'acrylic' || base.material === 'mica')
  const flip = (next: boolean): void => {
    // On a see-through theme, on is its own glass and off an edit to solid;
    // on a solid one, off is its own and on an edit to its mode's glass.
    if (baseGlassy) setAcrylic(next ? null : 0)
    else setAcrylic(next ? SEE_THROUGH_LEVEL[shown.mode] : null)
  }
  return (
    <SettingsSection id="this-theme" title={APP_SECTIONS['this-theme']}>
      {!shown.hc && (
        <SettingRow id="see-through" icon={iconPath(glass.icon)} label={glass.label} sub={glass.sub} tap>
          <Switch on={on} onChange={flip} label={glass.label} />
        </SettingRow>
      )}
      <SettingRow id="theme-edits" icon={iconPath(save.icon)} label={save.label} sub={save.sub}>
        <SaveButton dirty={dirty} onClick={savePreset} title="Keep this edit as your own copy" />
      </SettingRow>
    </SettingsSection>
  )
}

/** The app's typeface (the style's) and the interface's text size (the
 *  app's: it zooms the sidebar and this page, never the Explorer's rows). */
function TextSection(): JSX.Element {
  const style = useStyle()
  const size = useTreeSize()
  const font = appOpt('c-font')
  const ui = appOpt('tree-size')
  return (
    <SettingsSection id="app-text" title={APP_SECTIONS['app-text']}>
      <SettingRow id="c-font" icon={iconPath(font.icon)} label={font.label} sub={font.sub}>
        <Select id="c-font" value={style.font} onChange={(v) => setOverride('font', v)} options={FONT_OPTIONS} />
      </SettingRow>
      <SettingRow id="tree-size" icon={iconPath(ui.icon)} label={ui.label} sub={ui.sub}>
        <Select id="tree-size" value={size.id} onChange={(v) => setTreeSize(v as TreeSize)} options={TREE_SIZES} />
      </SettingRow>
    </SettingsSection>
  )
}

/** The window. Title bar and Tab width are window settings, not the style's
 *  (#250, #216): a style switch leaves them alone. Edges and corners are the
 *  style's own. */
function WindowSection(): JSX.Element {
  const style = useStyle()
  const titleBar = useTitleBarMode()
  const width = useTabWidth()
  const bar = appOpt('title-bar')
  const tab = appOpt('tab-width')
  const edges = appOpt('c-edges')
  const corners = appOpt('c-corners')
  return (
    <SettingsSection id="window" title={APP_SECTIONS.window}>
      {/* A switch over the same store the segmented control wrote: on is
          `shown`, the default, the window as it always was (#250). */}
      <SettingRow id="title-bar" icon={iconPath(bar.icon)} label={bar.label} sub={bar.sub} tap>
        <Switch on={titleBar === 'shown'} onChange={(on) => setTitleBarMode(on ? 'shown' : 'hidden')} label={bar.label} />
      </SettingRow>
      <SettingRow id="tab-width" icon={iconPath(tab.icon)} label={tab.label} sub={tab.sub}>
        <Segmented value={width} onChange={setTabWidth} options={TAB_WIDTH_OPTIONS} />
      </SettingRow>
      <SettingRow id="c-edges" icon={iconPath(edges.icon)} label={edges.label} sub={edges.sub}>
        <Segmented value={style.borders} onChange={(v) => setOverride('borders', v)} options={EDGE_OPTIONS} />
      </SettingRow>
      <SettingRow id="c-corners" icon={iconPath(corners.icon)} label={corners.label} sub={corners.sub}>
        <Segmented value={style.corners} onChange={(v) => setOverride('corners', v)} options={CORNER_OPTIONS} />
      </SettingRow>
    </SettingsSection>
  )
}

export function AppearancePage(): JSX.Element {
  return (
    <>
      <ThemesSection />
      <ThisThemeSection />
      <StyleColoursSection />
      <TextSection />
      <WindowSection />
    </>
  )
}
