import type { JSX } from 'react'
import { SettingBlock } from 'prism-term-core/renderer/settings/layout/SettingBlock'
import { SettingRow } from 'prism-term-core/renderer/settings/layout/SettingRow'
import { SettingsSection } from 'prism-term-core/renderer/settings/layout/SettingsSection'
import { TRANSPORT_GROUPS, TRANSPORT_STYLES, type TransportStyle } from '../../lib/transport'
import { DEFAULT_THEME_ID } from '../../lib/viz/styles'
import {
  applyPreset,
  setBarCycle,
  setBarGlow,
  setBarMove,
  setBarTheme,
  setCycle,
  setGlow,
  setMove,
  setTheme,
  useViz,
  type Preset,
  type VizState
} from '../../lib/vizStore'
import { VizPreview } from '../VizPreview'
import { APP_SECTIONS, appOpt, type MediaView } from './appOptions'
import { BlockLabel, CARD_GRID, Tile, TileFooter } from './cards'
import { ColourSection } from './ColourSchemes'
import { iconPath } from './icons'
import { TransportMini } from './TransportMini'

// MEDIA (2026-10-05, the grouped cards redesign): the Visualizer and the
// Progress bar were two pages with identical colour blocks, so they are one
// page now with a switch in its header, each half short. Which half shows is
// the Settings page's to remember while it is open.

/** Whether preset `p` matches the current live settings exactly. */
function isActivePreset(p: Preset, v: VizState): boolean {
  return (
    p.style === v.style &&
    p.height === v.height &&
    p.pos === v.pos &&
    p.width === v.width &&
    p.logo === v.logo &&
    (p.theme ?? DEFAULT_THEME_ID) === v.theme
  )
}

function VisualizerView(): JSX.Element {
  const v = useViz()
  const style = appOpt('viz-style')
  return (
    <>
      <SettingsSection id={style.section} title={APP_SECTIONS[style.section]}>
        <SettingBlock pad data-pref="viz-style">
          <div className={CARD_GRID}>
            {v.presets.map((p) => {
              const on = isActivePreset(p, v)
              return (
                <Tile key={p.id} on={on} onClick={() => applyPreset(p)}>
                  <div className="h-[78px] w-full overflow-hidden rounded-[5px] border border-[color:var(--p-divider)] bg-[var(--p-preview)]">
                    <VizPreview styleId={p.style} />
                  </div>
                  <TileFooter name={p.name} on={on} />
                </Tile>
              )
            })}
          </div>
        </SettingBlock>
      </SettingsSection>
      <ColourSection
        ids={{ block: 'viz-colour', glow: 'viz-glow', cycle: 'viz-cycle', move: 'viz-move' }}
        v={{ selectedId: v.theme, onPick: setTheme, glow: v.glow, cycle: v.cycle, move: v.move, onGlow: setGlow, onCycle: setCycle, onMove: setMove }}
      />
    </>
  )
}

function ProgressView({
  transportStyle,
  onPickTransport,
  transportBg,
  onPickTransportBg
}: {
  transportStyle: TransportStyle
  onPickTransport: (s: TransportStyle) => void
  transportBg: number
  onPickTransportBg: (pct: number) => void
}): JSX.Element {
  const v = useViz()
  const style = appOpt('transport-style')
  const band = appOpt('transport-bg')
  return (
    <>
      <SettingsSection id={style.section} title={APP_SECTIONS[style.section]}>
        <SettingBlock pad data-pref="transport-style">
          <div className="flex flex-col gap-3.5">
            {TRANSPORT_GROUPS.map((g) => {
              const items = TRANSPORT_STYLES.filter((s) => s.group === g)
              if (!items.length) return null
              return (
                <div key={g}>
                  <BlockLabel>{g}</BlockLabel>
                  <div className={CARD_GRID}>
                    {items.map((s) => {
                      const on = s.id === transportStyle
                      return (
                        <Tile key={s.id} on={on} onClick={() => onPickTransport(s.id)}>
                          <TransportMini id={s.id} />
                          <TileFooter name={s.name} on={on} />
                        </Tile>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </SettingBlock>
      </SettingsSection>
      <SettingsSection id={band.section} title={APP_SECTIONS[band.section]}>
        {/* Opaque is the bar as it has always been; all the way down, the
            picture runs to the bottom of the frame and the controls carry
            their own shadow. The subtext says which, as the slider moves. */}
        <SettingRow
          id="transport-bg"
          icon={iconPath(band.icon)}
          label={band.label}
          sub={
            transportBg === 0
              ? 'No band, the picture runs to the bottom.'
              : transportBg === 100
                ? 'A solid band behind the controls.'
                : band.sub
          }
        >
          <span className="w-[36px] text-right font-mono text-[11.5px] tabular-nums text-[var(--p-dim)]">{transportBg}%</span>
          <input
            id="transport-bg"
            type="range"
            min={0}
            max={100}
            step={5}
            value={transportBg}
            aria-label={band.label}
            onChange={(e) => onPickTransportBg(Number(e.target.value))}
            className="h-1.5 w-[180px] cursor-pointer appearance-none rounded-full bg-[var(--p-track)]"
            style={{ accentColor: 'var(--p-accent-solid)' }}
          />
        </SettingRow>
      </SettingsSection>
      <ColourSection
        ids={{ block: 'transport-colour', glow: 'transport-glow', cycle: 'transport-cycle', move: 'transport-move' }}
        v={{
          selectedId: v.barTheme,
          onPick: setBarTheme,
          glow: v.barGlow,
          cycle: v.barCycle,
          move: v.barMove,
          onGlow: setBarGlow,
          onCycle: setBarCycle,
          onMove: setBarMove
        }}
      />
    </>
  )
}

export function MediaPage({
  view,
  transportStyle,
  onPickTransport,
  transportBg,
  onPickTransportBg
}: {
  view: MediaView
  transportStyle: TransportStyle
  onPickTransport: (s: TransportStyle) => void
  transportBg: number
  onPickTransportBg: (pct: number) => void
}): JSX.Element {
  return view === 'visualizer' ? (
    <VisualizerView />
  ) : (
    <ProgressView
      transportStyle={transportStyle}
      onPickTransport={onPickTransport}
      transportBg={transportBg}
      onPickTransportBg={onPickTransportBg}
    />
  )
}
