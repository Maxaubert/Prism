import type { CSSProperties, JSX } from 'react'
import { SaveButton, Segmented, Select, Switch } from 'prism-term-core/renderer/settings/fields'
import { SettingBlock } from 'prism-term-core/renderer/settings/layout/SettingBlock'
import { SettingRow } from 'prism-term-core/renderer/settings/layout/SettingRow'
import { SettingsSection } from 'prism-term-core/renderer/settings/layout/SettingsSection'
import { setTabWidth, useTabWidth } from '../../lib/tabWidthPrefs'
import { setTitleBarMode, useTitleBarMode } from '../../lib/titleBarPrefs'
import { setTreeSize, TREE_SIZES, useTreeSize, type TreeSize } from '../../lib/treePrefs'
import { FONTS, isEdited, savePreset, setMode, setOverride, useMode, useOverrides, useStyle, type FontId, type Mode, type Style } from '../../lib/theme'
import { APP_SECTIONS, appOpt } from './appOptions'
import { iconPath } from './icons'
import { StyleColoursSection } from './StyleColours'
import { StyleWall } from './StyleWall'

// APPEARANCE (2026-10-05, the grouped cards redesign; it was Style): the
// style and its wall, the style's colours, the text, and the window. Rows
// marked as the style's (colours, App font, Panel edges, Corner roundness)
// are edits of the chosen style and light Save changes; the rest are this
// app's own and a style switch leaves them alone.
//
// THE FILE ICONS SWITCH IS GONE FROM HERE (owner, 2026-09-01: "hide that color
// setting for now ... we might come back to it"), and theme.ts forces the
// scheme to monochrome. Everything behind it is intact (IconScheme,
// iconSchemeOf, the iconScheme override, ICON_COLOURS, ICON_FULL_COLOUR), so
// bringing it back is a row with a Segmented of Monochrome / Coloured wired to
// setOverride('iconScheme'), plus flipping ICON_SCHEME_SHOWN.

const MODE_OPTIONS: Array<{ id: Mode; name: string }> = [
  { id: 'dark', name: 'Dark' },
  { id: 'light', name: 'Light' }
]

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

/** Mode, the style and its wall. Mode is a setting like any other, so it is
 *  a row of its own rather than a control tucked into the page header. */
function ThemeSection(): JSX.Element {
  const mode = useMode()
  const edits = useOverrides()
  // Ask the store rather than re-deriving it here: this list had already
  // fallen behind twice, and a Save button that misses an edit loses it.
  const dirty = isEdited()
  void edits // re-render when an edit lands, so `dirty` is read again
  const modeOpt = appOpt('mode')
  const theme = appOpt('style-theme')
  return (
    <SettingsSection id="style-theme" title={APP_SECTIONS['style-theme']}>
      <SettingRow id="mode" icon={iconPath(modeOpt.icon)} label={modeOpt.label} sub={modeOpt.sub}>
        <Segmented value={mode} onChange={setMode} options={MODE_OPTIONS} />
      </SettingRow>
      <SettingRow id="style-theme" icon={iconPath(theme.icon)} label={theme.label} sub={theme.sub}>
        <SaveButton dirty={dirty} onClick={savePreset} title="Keep this edit as a preset" />
      </SettingRow>
      <SettingBlock pad data-style-wall="">
        <StyleWall />
      </SettingBlock>
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
      <ThemeSection />
      <StyleColoursSection />
      <TextSection />
      <WindowSection />
    </>
  )
}
