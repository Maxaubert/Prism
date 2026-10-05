import type { JSX } from 'react'
import { Switch } from 'prism-term-core/renderer/settings/fields'
import { SettingBlock } from 'prism-term-core/renderer/settings/layout/SettingBlock'
import { SettingRow } from 'prism-term-core/renderer/settings/layout/SettingRow'
import { SettingsSection } from 'prism-term-core/renderer/settings/layout/SettingsSection'
import type { VizTheme } from '../../lib/viz/core'
import { ACCENT_THEME_ID } from '../../lib/viz/styles'
import { resolveVizTheme } from '../../lib/theme'
import { visibleThemes } from '../../lib/vizStore'
import { APP_SECTIONS, appOpt } from './appOptions'
import { BlockLabel } from './cards'
import { iconPath } from './icons'

// A COLOUR SCHEME AND ITS THREE EFFECTS, one section, worn by the visualizer
// and by the progress bar with their own values (2026-10-05: Media's two
// halves had identical Colour blocks, so they share this one). Base schemes
// are just Solid or Gradient (simple to complex); Glow, Cycle and Move are
// effects on top of any scheme, and they all combine.

function colourCategory(t: VizTheme): string {
  return t.palette.length <= 1 ? 'Solid' : 'Gradient'
}
const COLOUR_ORDER = ['Solid', 'Gradient']

/** A grid of plain filled swatches (no labels; the name on hover). */
function Swatches({
  items,
  selectedId,
  onPick
}: {
  items: Array<{ id: string; name: string; fill: string }>
  selectedId: string
  onPick: (id: string) => void
}): JSX.Element {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(48px,1fr))] gap-1.5">
      {items.map((it) => {
        const on = it.id === selectedId
        return (
          <button
            key={it.id}
            onClick={() => onPick(it.id)}
            title={it.name}
            aria-label={it.name}
            aria-pressed={on}
            className={`h-6 rounded-md transition ${
              on
                ? 'ring-2 ring-[var(--p-accent-hi)] ring-offset-1 ring-offset-[var(--p-bg)]'
                : 'ring-1 ring-white/10 hover:ring-white/30 focus-visible:ring-white/30'
            }`}
            // A swatch IS its fill (a colour or a gradient), so the inline
            // background beats the base focus fill: a focused swatch shows
            // focus as its hover does, the faint edge a step lighter (#272
            // review: an unselected swatch reached by Tab looked unfocused).
            style={{ background: it.fill }}
          />
        )
      })}
    </div>
  )
}

/** The schemes, Solid then Gradient. The accent-following scheme leads, drawn
 *  in the colour it is actually following rather than its placeholder. */
function SchemePicker({ selectedId, onPick }: { selectedId: string; onPick: (id: string) => void }): JSX.Element {
  const themes = [resolveVizTheme(ACCENT_THEME_ID), ...visibleThemes()]
  return (
    <div className="flex flex-col gap-3.5">
      {COLOUR_ORDER.map((cat) => {
        const items = themes.filter((t) => colourCategory(t) === cat)
        if (!items.length) return null
        return (
          <div key={cat}>
            <BlockLabel>{cat}</BlockLabel>
            <Swatches
              items={items.map((t) => ({
                id: t.id,
                name: t.name,
                fill: t.palette.length > 1 ? `linear-gradient(90deg, ${t.palette.join(', ')})` : t.palette[0]
              }))}
              selectedId={selectedId}
              onPick={onPick}
            />
          </div>
        )
      })}
    </div>
  )
}

export interface SchemeValues {
  selectedId: string
  onPick: (id: string) => void
  glow: boolean
  cycle: boolean
  move: boolean
  onGlow: (b: boolean) => void
  onCycle: (b: boolean) => void
  onMove: (b: boolean) => void
}

/** The row ids of one half's colour section, written where it is drawn. */
export interface SchemeIds {
  block: string
  glow: string
  cycle: string
  move: string
}

/** The colour section of one half of Media. */
export function ColourSection({ ids, v }: { ids: SchemeIds; v: SchemeValues }): JSX.Element {
  const block = appOpt(ids.block)
  const effects: Array<[string, boolean, (b: boolean) => void]> = [
    [ids.glow, v.glow, v.onGlow],
    [ids.cycle, v.cycle, v.onCycle],
    [ids.move, v.move, v.onMove]
  ]
  return (
    <SettingsSection id={block.section} title={APP_SECTIONS[block.section]}>
      <SettingBlock pad data-pref={block.id}>
        <SchemePicker selectedId={v.selectedId} onPick={v.onPick} />
      </SettingBlock>
      {effects.map(([id, on, set]) => {
        const o = appOpt(id)
        return (
          <SettingRow key={id} id={id} icon={iconPath(o.icon)} label={o.label} sub={o.sub} tap>
            <Switch on={on} onChange={set} label={o.label} />
          </SettingRow>
        )
      })}
    </SettingsSection>
  )
}
